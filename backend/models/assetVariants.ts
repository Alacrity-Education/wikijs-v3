import { fork, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { assets as assetsTable, tree as treeTable } from '../db/schema.ts'
import { detectImageMime, isAnimatedImage, readImageDimensions } from '../helpers/images.ts'
import { isVariantWidth, variantWidths } from '../helpers/imageVariants.ts'
import type { EncodeReply, EncodeRequest } from '../helpers/imageVariantEncoder.ts'

/** Defaults for `files.variants.*`, for a config that predates them. `base.yml` is the real source. */
const DEFAULTS = {
  enabled: true,
  quality: 80,
  concurrency: 2,
  cacheMaxSize: 1024 * 1024 * 1024,
  reconcileBudget: 180
}

/** The raster types a copy is made of. SVG is drawn at any size already; anything else is left alone. */
const VARIANT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** How long one image may take to encode before its process is killed and the attempt counted failed. */
const ENCODE_TIMEOUT_MS = 5 * 60_000

/** How long an encoder process may sit idle before it exits. Forked again on the next job. */
const ENCODER_IDLE_MS = 60_000

/** How long an asset whose encode failed for a reason that may pass is left alone. */
const RETRY_AFTER_MS = 30 * 60_000

/**
 * How much of an original is read out of the database per query.
 *
 * node-postgres receives a `bytea` as hex text and grows its read buffer by doubling until the whole
 * row fits: one 59 MB file read in one go came to a 118 MB string on the heap and ~430 MB of buffers
 * besides, per read, two reads at a time. In slices it is a few times this, whatever the file's size.
 */
const DB_READ_CHUNK = 4 * 1024 * 1024

/** As for the file cache: sweep once this much of the ceiling has been written, trim to this much. */
const SWEEP_TRIGGER_RATIO = 0.25
const SWEEP_TARGET_RATIO = 0.8

/**
 * The reconcile stops queuing once the cache is this full. Past it every copy it makes evicts another,
 * which the next run would make again — a budget too small for the wiki's images is left to fill on
 * demand instead of being churned on a schedule.
 */
const RECONCILE_FILL_RATIO = 0.9

/** What a copy is made from and filed under. `updatedAt` is the version: a replaced file is a new key. */
export interface VariantSource {
  id: string
  updatedAt: Date
  kind: string
  mimeType: string
  fileSize: number
  width?: number
}

/** What `/_files/<path>?w=` should send for a width. */
export type VariantLookup =
  | { type: 'copy'; filePath: string }
  /** The original is the file for this width: smaller than any copy, animated, or unreadable. */
  | { type: 'original' }
  /** No copy yet. One has been asked for; the original stands in without being cached as the copy. */
  | { type: 'pending' }

interface Job {
  key: string
  source: VariantSource
  done: Promise<void>
  resolve: () => void
}

interface Encoder {
  child: ChildProcess
  busy: boolean
  idleTimer?: NodeJS.Timeout
  pending?: { jobId: string; resolve: (reply: EncodeReply) => void }
}

function keyOf(source: { id: string; updatedAt: Date }): string {
  return `${source.id}-${source.updatedAt.getTime()}`
}

/**
 * Fork: the scaled-down WebP copies of uploaded images, made in the background and kept in a disk
 * cache of their own. See `.claude/rules/image-delivery.md` for the whole of it.
 *
 * - **Queue.** One job per image version (`<id>-<updatedAt>`), deduplicated: asking again for a job
 *   that is queued or running joins it. Jobs run in arrival order, at most `files.variants.concurrency`
 *   (2) at a time across this instance, each in one of that many encoder processes
 *   (`helpers/imageVariantEncoder.ts`) held to one thread apiece. In memory, because the copies are on
 *   this instance's disk: a job claimed off the shared queue by another instance would fill the wrong
 *   one. What a restart loses, the scheduled reconcile and the next request find again.
 * - **Cache.** `<dataPath>/cache/variants/<id[0:2]>/<id>-<updatedAt ms>-w<width>.webp`, or a zero-byte
 *   `.orig` marker where the original is the better file. Its own directory and its own ceiling
 *   (`files.variants.cacheMaxSize`), apart from the file cache: those entries are refilled from
 *   storage on a miss for the price of a read, these for seconds of CPU, and sharing one oldest-first
 *   budget would let a burst of ordinary reads evict every copy and set the encoders remaking them.
 */
export class AssetVariants {
  queue: Job[] = []
  jobs = new Map<string, Job>()
  running = 0
  encoders: Encoder[] = []
  /** Image versions whose encode failed: key -> when, or Infinity for a failure that will not pass. */
  failures = new Map<string, number>()
  writtenSinceSweep = 0
  sweeping = false
  /** The most jobs ever seen running at once, for the logs and the tests. */
  peakRunning = 0
  /** Who is waiting for a job to finish (`waitForProgress`), woken together when one does. */
  progressWaiters: (() => void)[] = []

  get settings(): typeof DEFAULTS {
    return { ...DEFAULTS, ...WIKI.config.files?.variants }
  }

  get concurrency(): number {
    return Math.max(1, Math.floor(Number(this.settings.concurrency) || 1))
  }

  get cachePath(): string {
    return path.resolve(WIKI.ROOTPATH, WIKI.config.dataPath, 'cache/variants')
  }

  variantPath(
    source: { id: string; updatedAt: Date },
    width: number,
    ext: 'webp' | 'orig'
  ): string {
    return path.join(this.cachePath, source.id.slice(0, 2), `${keyOf(source)}-w${width}.${ext}`)
  }

  /**
   * Whether copies are ever made of this asset, from what its row says. Animation is not on the row,
   * so an animated GIF passes here and is caught by the encode, which marks every width `.orig`.
   */
  isCandidate(source: VariantSource): boolean {
    return (
      Boolean(this.settings.enabled) &&
      source.kind === 'image' &&
      VARIANT_MIME_TYPES.has(source.mimeType) &&
      variantWidths(source.width).length > 0
    )
  }

  /** Whether Sharp can be used here. Without it nothing is queued, and every request gets the original. */
  async isAvailable(): Promise<boolean> {
    const definition = WIKI.models.extensions.getDefinition('sharp')
    return Boolean(
      definition &&
      !WIKI.models.extensions.hasLoadFailed(definition) &&
      (await WIKI.models.extensions.isInstalled(definition))
    )
  }

  // == SERVING ========================

  /**
   * What to send for `?w=<width>`, or null when the width is not one of this image's copies (or the
   * asset is not one that has any) — the caller then serves the original as if no width was asked.
   *
   * Never encodes. A missing copy is queued, and the answer is `pending`.
   */
  async lookup(source: VariantSource, width: number): Promise<VariantLookup | null> {
    if (!this.isCandidate(source) || !isVariantWidth(width, source.width)) {
      return null
    }
    const copy = this.variantPath(source, width, 'webp')
    if (await fileExists(copy)) {
      return { type: 'copy', filePath: copy }
    }
    if (await fileExists(this.variantPath(source, width, 'orig'))) {
      return { type: 'original' }
    }
    // -> Without Sharp no copy is coming, so the original is the answer and may be cached as one
    if (!(await this.isAvailable())) {
      return null
    }
    this.request(source)
    return { type: 'pending' }
  }

  // == QUEUE ==========================

  /**
   * Ask for an image's copies, in the background. Returns at once; the promise is for whoever wants
   * to wait (the reconcile), and resolves whatever the outcome, never rejects.
   */
  request(source: VariantSource): Promise<void> {
    const key = keyOf(source)
    const existing = this.jobs.get(key)
    if (existing) {
      return existing.done
    }
    const failedAt = this.failures.get(key)
    if (failedAt !== undefined && Date.now() - failedAt < RETRY_AFTER_MS) {
      return Promise.resolve()
    }
    if (!this.isCandidate(source)) {
      return Promise.resolve()
    }
    let resolve!: () => void
    const done = new Promise<void>((r) => {
      resolve = r
    })
    const job: Job = { key, source, done, resolve }
    this.jobs.set(key, job)
    this.queue.push(job)
    // -> Next tick: the caller is an upload or a request, and neither waits for any of this
    setImmediate(() => this.drain())
    return done
  }

  /** Whether a job for this image version is queued or running. */
  isQueued(source: { id: string; updatedAt: Date }): boolean {
    return this.jobs.has(keyOf(source))
  }

  drain(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!
      this.running++
      this.peakRunning = Math.max(this.peakRunning, this.running)
      void this.run(job).finally(() => {
        this.running--
        this.jobs.delete(job.key)
        job.resolve()
        this.drain()
        const waiters = this.progressWaiters
        this.progressWaiters = []
        for (const wake of waiters) {
          wake()
        }
      })
    }
  }

  /**
   * Resolve when the next job finishes, or after `ms`, whichever is first. One timer per wait, cleared
   * when it is not needed: what the reconcile throttles itself on. Waiting on the jobs' own promises
   * instead spins -- one already settled answers every `Promise.race` at once, the loop never yields
   * to the event loop that would let the queue move, and each turn leaves a timer behind until the
   * heap is gone. That took the whole wiki down on a real data set.
   */
  waitForProgress(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer)
        this.progressWaiters = this.progressWaiters.filter((w) => w !== wake)
        resolve()
      }
      const timer = setTimeout(wake, ms)
      this.progressWaiters.push(wake)
    })
  }

  async run(job: Job): Promise<void> {
    const { source } = job
    const started = Date.now()
    try {
      if (!(await this.isAvailable())) {
        return
      }
      // -> Still the version this job is for? A file replaced while it waited has a job of its own
      if (!(await this.isCurrent(source))) {
        return
      }
      const data = await this.readOriginal(source)
      if (!data) {
        return
      }
      const widths = variantWidths(source.width)
      // -> Caught here rather than by the encoder, so an animated GIF costs nobody a decode
      if (!detectImageMime(data) || isAnimatedImage(data)) {
        await this.markOriginal(source, widths)
        WIKI.logger.debug(
          `Image copies: ${source.id} is animated or not a raster image, served as is`
        )
        return
      }
      WIKI.logger.info(
        `Image copies: encoding ${source.id} (${source.width}px, ${widths.length} widths) [ ${this.running}/${this.concurrency} running ]`
      )
      const reply = await this.encode({
        jobId: job.key,
        data,
        widths,
        quality: Number(this.settings.quality) || DEFAULTS.quality,
        originalSize: data.length
      })
      if (!reply.ok) {
        WIKI.logger.warn(`Image copies: could not encode ${source.id}: ${reply.error}`)
        if (reply.permanent) {
          // -> Remembered on disk, so neither a request nor the reconcile asks again for this version
          await this.markOriginal(source, widths)
        } else {
          this.failures.set(job.key, Date.now())
        }
        return
      }
      if (!(await this.isCurrent(source))) {
        return
      }
      let bytes = 0
      for (const variant of reply.variants) {
        if (variant.data) {
          await this.writeAtomic(this.variantPath(source, variant.width, 'webp'), variant.data)
          bytes += variant.data.length
        } else {
          await this.writeAtomic(this.variantPath(source, variant.width, 'orig'), Buffer.alloc(0))
        }
      }
      this.failures.delete(job.key)
      WIKI.logger.info(
        `Image copies: ${source.id} done in ${Date.now() - started}ms, ${reply.lossless ? 'lossless' : 'lossy'}, ${data.length} -> ${bytes} bytes over ${reply.variants.length} widths [ OK ]`
      )
      this.writtenSinceSweep += bytes
      if (this.writtenSinceSweep >= this.maxSize * SWEEP_TRIGGER_RATIO) {
        void this.sweep()
      }
    } catch (err: any) {
      this.failures.set(job.key, Date.now())
      WIKI.logger.warn(`Image copies: ${source.id} failed: ${err.message}`)
    }
  }

  async isCurrent(source: VariantSource): Promise<boolean> {
    const rows = await WIKI.db
      .select({ updatedAt: assetsTable.updatedAt })
      .from(assetsTable)
      .where(eq(assetsTable.id, source.id))
      .limit(1)
    return rows[0]?.updatedAt?.getTime() === source.updatedAt.getTime()
  }

  /**
   * The original's bytes: off the file cache where this instance has them, since that is a local read;
   * out of the asset's own row in slices where the database holds a copy; from storage otherwise.
   * Never filling the file cache, which a backfill of every image in the wiki would churn through.
   *
   * The database copy is read here rather than through `getContent` for the memory: see
   * `DB_READ_CHUNK`. A row whose `data` is set holds the current bytes regardless of which target is
   * nominated for delivery — every write goes to every target storing the type, and the database
   * target clears the column when it stops storing it — so reading it is not a second opinion.
   */
  async readOriginal(source: VariantSource): Promise<Buffer | null> {
    try {
      return await fs.readFile(WIKI.models.assets.contentCachePath(source))
    } catch {
      // -> Not cached on this instance
    }
    const fromDb = await this.readFromDatabase(source.id)
    if (fromDb) {
      return fromDb
    }
    return (await WIKI.models.assets.getContent(source.id))?.data ?? null
  }

  /** The database target's copy, read in slices into one buffer. Null when the row holds none. */
  async readFromDatabase(id: string): Promise<Buffer | null> {
    const sized = await WIKI.db.execute(
      sql`SELECT octet_length(${assetsTable.data})::bigint AS "length" FROM ${assetsTable} WHERE ${assetsTable.id} = ${id}`
    )
    const length = Number(sized.rows[0]?.length ?? Number.NaN)
    if (!Number.isFinite(length)) {
      return null
    }
    const data = Buffer.allocUnsafe(length)
    for (let offset = 0; offset < length; offset += DB_READ_CHUNK) {
      const part = await WIKI.db.execute(
        sql`SELECT substring(${assetsTable.data} FROM ${offset + 1} FOR ${DB_READ_CHUNK}) AS "part" FROM ${assetsTable} WHERE ${assetsTable.id} = ${id}`
      )
      const chunk = part.rows[0]?.part as Buffer | undefined
      // -> Replaced or deleted mid-read: the caller's `isCurrent` check would catch the first, but a
      //    short read is not worth handing on either way
      if (!chunk || chunk.length !== Math.min(DB_READ_CHUNK, length - offset)) {
        return null
      }
      chunk.copy(data, offset)
    }
    return data
  }

  async markOriginal(source: VariantSource, widths: number[]): Promise<void> {
    for (const width of widths) {
      await this.writeAtomic(this.variantPath(source, width, 'orig'), Buffer.alloc(0))
    }
  }

  async writeAtomic(filePath: string, data: Uint8Array): Promise<void> {
    const tempPath = `${filePath}.${process.pid}.tmp`
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(tempPath, data)
      await fs.rename(tempPath, filePath)
    } catch (err) {
      await fs.rm(tempPath, { force: true }).catch(() => {})
      throw err
    }
  }

  // == ENCODER PROCESSES ==============

  /** Hand one image to a free encoder process, forking one if fewer than `concurrency` are alive. */
  encode(request: EncodeRequest): Promise<EncodeReply> {
    let encoder = this.encoders.find((e) => !e.busy)
    if (!encoder) {
      encoder = this.forkEncoder()
    }
    const current = encoder
    current.busy = true
    clearTimeout(current.idleTimer)
    return new Promise<EncodeReply>((resolve) => {
      const timer = setTimeout(() => {
        WIKI.logger.warn(`Image copies: encoding ${request.jobId} took too long; stopping it`)
        current.child.kill('SIGKILL')
      }, ENCODE_TIMEOUT_MS)
      current.pending = {
        jobId: request.jobId,
        resolve: (reply) => {
          clearTimeout(timer)
          current.pending = undefined
          current.busy = false
          current.idleTimer = setTimeout(() => {
            // -> Out of the list first, so that no job is handed to a process on its way out
            this.encoders = this.encoders.filter((e) => e !== current)
            current.child.kill()
          }, ENCODER_IDLE_MS)
          resolve(reply)
        }
      }
      current.child.send(request)
    })
  }

  forkEncoder(): Encoder {
    const child = fork(path.join(WIKI.SERVERPATH, 'helpers/imageVariantEncoder.ts'), [], {
      serialization: 'advanced',
      // -> Sharp runs its pipelines on the libuv pool: one thread, so an encode is one core
      env: { ...process.env, UV_THREADPOOL_SIZE: '1' },
      // -> Not the parent's `--inspect`, which would fight it for the port
      execArgv: process.execArgv.filter((arg) => !arg.startsWith('--inspect')),
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    })
    const encoder: Encoder = { child, busy: false }
    child.on('message', (reply: EncodeReply) => {
      if (encoder.pending && reply.jobId === encoder.pending.jobId) {
        encoder.pending.resolve(reply)
      }
    })
    child.on('exit', (code, signal) => {
      this.encoders = this.encoders.filter((e) => e !== encoder)
      clearTimeout(encoder.idleTimer)
      encoder.pending?.resolve({
        jobId: encoder.pending.jobId,
        ok: false,
        permanent: false,
        error: `The encoder process exited (${signal ?? code}) mid-image`
      })
    })
    child.on('error', (err) => WIKI.logger.warn(`Image copies: encoder process: ${err.message}`))
    this.encoders.push(encoder)
    return encoder
  }

  /** Stop every encoder process, for a shutdown. Queued jobs are dropped; the reconcile finds them. */
  stop(): void {
    this.queue = []
    for (const encoder of this.encoders) {
      encoder.child.kill()
    }
  }

  // == CACHE ==========================

  get maxSize(): number {
    return Number(this.settings.cacheMaxSize) || 0
  }

  /** Every copy these assets have, of every version. For a replace, a delete, a folder deleted. */
  async drop(ids: string[]): Promise<void> {
    for (const id of ids) {
      const shard = path.join(this.cachePath, id.slice(0, 2))
      try {
        const entries = await fs.readdir(shard)
        await Promise.all(
          entries
            .filter((name) => name.startsWith(`${id}-`))
            .map((name) => fs.rm(path.join(shard, name), { force: true }))
        )
      } catch {
        // -> Nothing cached for it on this instance
      }
    }
  }

  /**
   * Carry an asset's copies from one version to the next, for a change that left the bytes alone (a
   * rename or a move, which bump `updatedAt` and so the key). Anything that cannot be carried is
   * dropped, and the reconcile or the next request makes it again.
   */
  async rekey(id: string, from: Date, to: Date): Promise<void> {
    if (from.getTime() === to.getTime()) {
      return
    }
    const shard = path.join(this.cachePath, id.slice(0, 2))
    const fromPrefix = `${keyOf({ id, updatedAt: from })}-w`
    const toPrefix = `${keyOf({ id, updatedAt: to })}-w`
    let entries: string[]
    try {
      entries = await fs.readdir(shard)
    } catch {
      return
    }
    for (const name of entries) {
      if (!name.startsWith(`${id}-`)) {
        continue
      }
      const at = path.join(shard, name)
      if (name.startsWith(fromPrefix) && !name.endsWith('.tmp')) {
        await fs
          .rename(at, path.join(shard, toPrefix + name.slice(fromPrefix.length)))
          .catch(() => {})
      } else {
        await fs.rm(at, { force: true })
      }
    }
  }

  async purge(): Promise<void> {
    this.writtenSinceSweep = 0
    this.failures.clear()
    await fs.rm(this.cachePath, { recursive: true, force: true })
    await fs.mkdir(this.cachePath, { recursive: true })
  }

  /** Every entry on disk, with its size and when it was written. */
  async listCache(): Promise<{ path: string; name: string; size: number; writtenAt: number }[]> {
    const files: { path: string; name: string; size: number; writtenAt: number }[] = []
    let entries
    try {
      entries = await fs.readdir(this.cachePath, { recursive: true, withFileTypes: true })
    } catch {
      return files
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(webp|orig)$/.test(entry.name)) {
        continue
      }
      const filePath = path.join(entry.parentPath, entry.name)
      const stat = await fs.stat(filePath).catch(() => null)
      if (stat) {
        files.push({ path: filePath, name: entry.name, size: stat.size, writtenAt: stat.mtimeMs })
      }
    }
    return files
  }

  /** Trim back under the ceiling, oldest first, as the file cache does. */
  async sweep(): Promise<void> {
    if (this.sweeping) {
      return
    }
    this.sweeping = true
    this.writtenSinceSweep = 0
    try {
      const files = await this.listCache()
      let total = files.reduce((sum, f) => sum + f.size, 0)
      if (total <= this.maxSize) {
        return
      }
      files.sort((a, b) => a.writtenAt - b.writtenAt)
      const target = this.maxSize * SWEEP_TARGET_RATIO
      let removed = 0
      for (const file of files) {
        if (total <= target) {
          break
        }
        await fs.rm(file.path, { force: true })
        total -= file.size
        removed++
      }
      WIKI.logger.info(`Image copies: trimmed ${removed} file(s) from the cache [ OK ]`)
    } catch (err: any) {
      WIKI.logger.warn(`Image copies: could not sweep the cache: ${err.message}`)
    } finally {
      this.sweeping = false
    }
  }

  // == RECONCILE ======================

  /**
   * Make the copies every image on this instance is missing, for the scheduled `reconcileImageVariants`.
   *
   * What catches whatever the upload path did not see: an import (2.x, `.wkbackup`), a storage target
   * syncing files in, a copy swept, an upload on another instance, a restart that dropped the queue.
   * Idempotent — a run with nothing missing reads one query and one directory listing and queues
   * nothing — and bounded: it queues while `reconcileBudget` seconds last, no faster than the encoders
   * take the work, then waits for what it queued and stops. The next run carries on.
   *
   * An image with no stored width is measured and the width stored (on the asset and its tree entry),
   * since `variantWidths` and the page's `srcset` both go by it.
   */
  async reconcile({ signal }: { signal?: AbortSignal } = {}): Promise<{
    checked: number
    queued: number
    measured: number
    staleRemoved: number
  }> {
    const result = { checked: 0, queued: 0, measured: 0, staleRemoved: 0 }
    if (!this.settings.enabled || !(await this.isAvailable())) {
      return result
    }
    const deadline = Date.now() + (Number(this.settings.reconcileBudget) || 0) * 1000

    const rows = await WIKI.db
      .select({
        id: assetsTable.id,
        updatedAt: assetsTable.updatedAt,
        kind: assetsTable.kind,
        mimeType: assetsTable.mimeType,
        fileSize: assetsTable.fileSize,
        meta: assetsTable.meta
      })
      .from(assetsTable)
      .where(
        and(eq(assetsTable.kind, 'image'), inArray(assetsTable.mimeType, [...VARIANT_MIME_TYPES]))
      )

    // -> One listing for the whole run; a file per expected copy would be thousands of stats
    const cached = await this.listCache()
    const present = new Set(cached.map((f) => f.name.replace(/\.(webp|orig)$/, '')))
    let cacheBytes = cached.reduce((sum, f) => sum + f.size, 0)

    // -> Copies of a version that is no longer current: another instance replaced the file, or the
    //    process stopped between a replace and its drop. Only for assets that still exist; the
    //    sweep takes the rest
    const currentKeys = new Map(rows.map((r) => [r.id, keyOf(r)]))
    for (const file of cached) {
      const match = /^([0-9a-f-]{36})-(\d+)-w\d+\./.exec(file.name)
      if (
        match &&
        currentKeys.has(match[1]) &&
        currentKeys.get(match[1]) !== `${match[1]}-${match[2]}`
      ) {
        await fs.rm(file.path, { force: true })
        cacheBytes -= file.size
        result.staleRemoved++
      }
    }

    const waiting: Promise<void>[] = []
    for (const row of rows) {
      if (signal?.aborted || Date.now() > deadline) {
        break
      }
      const meta = (row.meta ?? {}) as Record<string, any>
      const source: VariantSource = {
        id: row.id,
        updatedAt: row.updatedAt,
        kind: row.kind,
        mimeType: row.mimeType,
        fileSize: row.fileSize ?? 0,
        width: meta.width
      }
      result.checked++
      if (!source.width) {
        const measured = await this.measure(source)
        if (!measured) {
          continue
        }
        source.width = measured
        result.measured++
      }
      const widths = variantWidths(source.width)
      if (widths.length < 1 || this.isQueued(source)) {
        continue
      }
      const key = keyOf(source)
      if (widths.every((w) => present.has(`${key}-w${w}`))) {
        continue
      }
      if (this.maxSize > 0 && cacheBytes >= this.maxSize * RECONCILE_FILL_RATIO) {
        WIKI.logger.info('Image copies: the cache is full; leaving the rest to be made on demand')
        break
      }
      // -> No faster than the encoders take it, so that the budget bounds what this run starts
      while (this.queue.length >= this.concurrency && Date.now() <= deadline && !signal?.aborted) {
        await this.waitForProgress(1000)
      }
      if (signal?.aborted || Date.now() > deadline) {
        break
      }
      waiting.push(this.request(source))
      result.queued++
      // -> A rough figure, so that a run does not queue far past the fill line before the first
      //    copy lands
      cacheBytes += Math.round(source.fileSize / 4)
    }
    await Promise.all(waiting)
    return result
  }

  /**
   * Read an image's width off its bytes and store it, for a row that arrived without one (an import
   * written straight into the table, an upload made while Sharp was missing). Remembered as a failure
   * when it cannot be read, so the next run does not fetch the file again for the same answer.
   */
  async measure(source: VariantSource): Promise<number | null> {
    const key = keyOf(source)
    if (this.failures.has(key)) {
      return null
    }
    const data = await this.readOriginal(source)
    const dimensions = data ? await readImageDimensions(data) : null
    if (!dimensions) {
      WIKI.logger.info(`Image copies: ${source.id} has no width and none could be read; skipped`)
      this.failures.set(key, Infinity)
      return null
    }
    const [row] = await WIKI.db
      .select({ meta: assetsTable.meta })
      .from(assetsTable)
      .where(eq(assetsTable.id, source.id))
    const [entry] = await WIKI.db
      .select({ meta: treeTable.meta })
      .from(treeTable)
      .where(eq(treeTable.id, source.id))
    // -> `updatedAt` is left alone: the file has not changed, and bumping it would orphan its copies
    await WIKI.db
      .update(assetsTable)
      .set({ meta: { ...(row?.meta as object), ...dimensions } })
      .where(eq(assetsTable.id, source.id))
    if (entry) {
      await WIKI.db
        .update(treeTable)
        .set({ meta: { ...(entry.meta as object), ...dimensions } })
        .where(eq(treeTable.id, source.id))
    }
    WIKI.logger.info(
      `Image copies: measured ${source.id} at ${dimensions.width}x${dimensions.height}`
    )
    return dimensions.width
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
