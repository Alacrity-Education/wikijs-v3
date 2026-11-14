import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import {
  assets as assetsTable,
  assetUsages as assetUsagesTable,
  jobHistory as jobHistoryTable,
  jobs as jobsTable,
  pages as pagesTable,
  sites as sitesTable,
  tree as treeTable
} from '../db/schema.ts'
import { decodeTreePath } from '../helpers/common.ts'
import { liveCondition } from '../helpers/publishing.ts'
import { findAssetReferences } from '../helpers/assetUsages.ts'
import type { AssetReference } from '../helpers/assetUsages.ts'
import type { SourceSyntax } from '../helpers/linkRewrite.ts'

/**
 * Where each uploaded file is used: the `assetUsages` index.
 *
 * Filled by the `rescanAssetUsages` job, which reads every page's source and records each reference
 * to a file with its exact position -- see `helpers/assetUsages.ts` for how a reference is found and
 * resolved. The job runs every three hours (`SYSTEM_SCHEDULE`) and on demand from the file manager.
 * Between scans the index can be behind: a page saved, or a file moved, since the last one shows up
 * at the next.
 *
 * Imports only the schema and pure helpers, so the job can run it in a worker thread: see `worker.ts`
 * on what pulling in the other models would cost there.
 */

/** The scheduler task that rebuilds the index. */
export const RESCAN_TASK = 'rescanAssetUsages'

/** How many pages are read at once. A page's source can be large, so this is a memory ceiling. */
const BATCH_SIZE = 50

/** How many rows go into one INSERT. Postgres caps a statement's parameters at 65535. */
const INSERT_CHUNK = 1000

/** Which syntax each content type is written in, for the content types that hold a page's text. */
const SYNTAX_OF: Record<string, SourceSyntax> = {
  markdown: 'markdown',
  adoc: 'adoc'
}

/** Whether a rescan is waiting or under way, and when the last one finished. */
export interface AssetUsageStatus {
  isRunning: boolean
  lastScanAt: string | null
}

/** One place a file is used, as the file manager lists it. */
export interface AssetUsage {
  pageId: string
  locale: string
  path: string
  title: string
  kind: string
  raw: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  /** The page's tags, which page rules may match on. */
  tags: string[]
  /** Whether the page is live, which decides who besides its editors may see it. */
  isLive: boolean
}

export const assetUsages = {
  /**
   * Rebuild the index for every site, one site at a time.
   *
   * Each site's references are worked out first and then swapped in with one transaction, so a reader
   * never sees a site half-scanned. All the work before the swap is reads, done outside it: in a
   * worker the pool has a single connection, and a transaction held across other queries would wait on
   * itself.
   *
   * @returns How many references were recorded, across all sites.
   */
  async rescan(): Promise<number> {
    const sites = await WIKI.db
      .select({ id: sitesTable.id, hostname: sitesTable.hostname, config: sitesTable.config })
      .from(sitesTable)
    // -> The catch-all `*` is left out, as `pageLinks` leaves it out: honouring it would make every
    //    address on every other server one on this site
    const hostSites = new Map(
      sites.filter((s) => s.hostname !== '*').map((s) => [s.hostname.toLowerCase(), s.id])
    )

    let total = 0
    for (const site of sites) {
      const config = (site.config ?? {}) as Record<string, any>
      const files = await this.filesOf(site.id, config.locales?.primary ?? 'en')
      const pageExtensions: string[] = (config.pageExtensions ?? []).map((ext: string) =>
        String(ext).toLowerCase()
      )

      const rows: (AssetReference & { pageId: string; siteId: string })[] = []
      let cursor: string | null = null
      for (;;) {
        const pages: {
          id: string
          path: string
          contentType: string
          content: string | null
        }[] = await WIKI.db
          .select({
            id: pagesTable.id,
            path: pagesTable.path,
            contentType: pagesTable.contentType,
            content: pagesTable.content
          })
          .from(pagesTable)
          .where(
            and(
              eq(pagesTable.siteId, site.id),
              inArray(pagesTable.contentType, Object.keys(SYNTAX_OF)),
              cursor ? gt(pagesTable.id, cursor) : undefined
            )
          )
          .orderBy(asc(pagesTable.id))
          .limit(BATCH_SIZE)
        if (pages.length < 1) {
          break
        }
        for (const page of pages) {
          // -> One page that will not scan does not stop the rest: this is an index, and a hole in
          //    it is better than none
          try {
            const refs = findAssetReferences(page.content ?? '', SYNTAX_OF[page.contentType], {
              pagePath: page.path,
              siteId: site.id,
              pageExtensions,
              siteForHost: (hostname) => hostSites.get(hostname) ?? null,
              assetAt: (filePath) => files.get(filePath) ?? null
            })
            for (const ref of refs) {
              rows.push({ ...ref, pageId: page.id, siteId: site.id })
            }
          } catch (err: any) {
            WIKI.logger.warn(`Could not scan page ${page.id} for file references: ${err.message}`)
          }
        }
        cursor = pages.at(-1)!.id
      }

      await WIKI.db.transaction(async (tx) => {
        await tx.delete(assetUsagesTable).where(eq(assetUsagesTable.siteId, site.id))
        for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
          await tx.insert(assetUsagesTable).values(rows.slice(i, i + INSERT_CHUNK))
        }
      })
      total += rows.length
    }
    return total
  },

  /**
   * Every file on a site, by the path a reference resolves to: the folder path decoded and joined to
   * the file name, both already lowercase and NFC in the tree. Where a path holds a file in several
   * locales, the primary locale's wins, as `assets.getAssetByPath` picks it.
   */
  async filesOf(siteId: string, primaryLocale: string): Promise<Map<string, string>> {
    const rows = await WIKI.db
      .select({
        id: assetsTable.id,
        folderPath: treeTable.folderPath,
        fileName: treeTable.fileName,
        locale: treeTable.locale
      })
      .from(assetsTable)
      .innerJoin(treeTable, eq(treeTable.id, assetsTable.id))
      .where(and(eq(assetsTable.siteId, siteId), eq(treeTable.type, 'asset')))
    const files = new Map<string, string>()
    for (const row of rows) {
      const folder = decodeTreePath(row.folderPath)
      const key = folder ? `${folder}/${row.fileName}` : row.fileName
      if (!files.has(key) || row.locale === primaryLocale) {
        files.set(key, row.id)
      }
    }
    return files
  },

  /**
   * Whether a rescan is queued or running, and when the last one completed.
   *
   * Read off the scheduler's own tables rather than kept anywhere: a job due in `jobs`, or one
   * whose history row is still `active`, is a scan under way -- on any instance -- and the latest
   * `completed` row is the last scan. A scan abandoned by an instance that went down stays `active`
   * until the scheduler reaps it.
   */
  async status(): Promise<AssetUsageStatus> {
    // -> Only a job that is due: the scheduler queues the coming scheduled runs ahead of time, each
    //    waiting for its hour, and those are not a scan under way
    const [queued] = await WIKI.db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.task, RESCAN_TASK),
          or(isNull(jobsTable.waitUntil), lte(jobsTable.waitUntil, sql`now()`))
        )
      )
    const [active] = await WIKI.db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobHistoryTable)
      .where(and(eq(jobHistoryTable.task, RESCAN_TASK), eq(jobHistoryTable.state, 'active')))
    const [last] = await WIKI.db
      .select({ completedAt: jobHistoryTable.completedAt })
      .from(jobHistoryTable)
      .where(and(eq(jobHistoryTable.task, RESCAN_TASK), eq(jobHistoryTable.state, 'completed')))
      .orderBy(desc(jobHistoryTable.completedAt))
      .limit(1)
    return {
      isRunning: (queued?.n ?? 0) + (active?.n ?? 0) > 0,
      lastScanAt: last?.completedAt
        ? last.completedAt.toTemporalInstant().toString({ smallestUnit: 'millisecond' })
        : null
    }
  },

  /**
   * Queue a rescan, unless one is already waiting or running -- a second would only redo the first.
   *
   * @returns Whether a new scan was queued.
   */
  async queueRescan(): Promise<boolean> {
    if ((await this.status()).isRunning) {
      return false
    }
    const added = await WIKI.scheduler.addJob({ task: RESCAN_TASK })
    if (!added?.id) {
      throw new Error('The scheduler could not queue the rescan.')
    }
    return true
  },

  /**
   * Every recorded use of one file, with the page it is on, in page order and then source order.
   *
   * Not filtered by who is asking: the caller decides which of the pages it may show, from `tags` and
   * `isLive`.
   */
  async usagesOf(siteId: string, assetId: string): Promise<AssetUsage[]> {
    return WIKI.db
      .select({
        pageId: assetUsagesTable.pageId,
        locale: pagesTable.locale,
        path: pagesTable.path,
        title: pagesTable.title,
        kind: assetUsagesTable.kind,
        raw: assetUsagesTable.raw,
        startLine: assetUsagesTable.startLine,
        startColumn: assetUsagesTable.startColumn,
        endLine: assetUsagesTable.endLine,
        endColumn: assetUsagesTable.endColumn,
        tags: pagesTable.tags,
        isLive: sql<boolean>`${liveCondition(pagesTable)}`
      })
      .from(assetUsagesTable)
      .innerJoin(pagesTable, eq(pagesTable.id, assetUsagesTable.pageId))
      .where(and(eq(assetUsagesTable.siteId, siteId), eq(assetUsagesTable.assetId, assetId)))
      .orderBy(asc(pagesTable.path), asc(pagesTable.locale), asc(assetUsagesTable.startOffset))
  }
}
