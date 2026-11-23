---
paths:
  - "backend/helpers/imageVariants.ts"
  - "backend/helpers/imageVariantEncoder.ts"
  - "backend/models/assetVariants.ts"
  - "backend/models/assets.ts"
  - "backend/controllers/files.ts"
  - "backend/tasks/simple/reconcile-image-variants.ts"
---

# Image delivery: scaled-down copies (fork)

An uploaded raster image is also served as **WebP copies at fixed widths**, asked for as
`/_files/<path>?w=<width>`. `helpers/imageVariants.ts` is the contract every part shares — the widths
(`variantWidths`: 320 px × 1.5ⁿ, every step narrower than the image, no cap), `isVariantWidth`,
`variantUrl`. Nothing else decides a width, and nothing is ever encoded at a width off that ladder.

**Never made in a request.** Copies are made in the background, by `models/assetVariants.ts`
(`WIKI.models.assets.variants`):

- **After an upload, a replace, an editor save, an import that adopts a file** — every path that writes
  new bytes calls `assets.queueVariants(id)` (in `upload`, `replace`, `adoptStoredFile`), fire and
  forget. The upload response does not wait for it.
- **On a schedule** — `reconcileImageVariants`, every 15 minutes (`SYSTEM_SCHEDULE`). It is what finds
  images that never passed through those paths (a 2.x import, a `.wkbackup`, a storage sync, rows
  written by hand), copies the cache swept, uploads made on another instance, and a queue a restart
  dropped. It also measures and stores `meta.width`/`height` for an image row that has none, and
  removes copies made for an older version of a file. Bounded by `files.variants.reconcileBudget`
  seconds of queuing per run; a run with nothing to do is one query and one directory listing.
- **On a miss** — `/_files/…?w=` with no copy yet queues one (deduplicated) and sends the original.

**At most `files.variants.concurrency` (2) encodes at once, per instance, for all three.** One
in-memory queue, deduplicated by `<id>-<updatedAt>`, drained by that many **child processes**
(`helpers/imageVariantEncoder.ts`, forked on demand, exiting after a minute idle). A process, not a
worker thread or a promise: Sharp works on libvips's threads and the libuv pool, which a worker thread
shares with the server, so neither would cap anything. In the child libvips is held to one thread
(`sharp.concurrency(1)`) and libuv to one (`UV_THREADPOOL_SIZE=1`), so an encode is one core, it never
occupies the pool the server's file reads use, and a decoder crash or a memory blow-up ends the child.
The reconcile throttles itself on `waitForProgress` (woken when a job finishes), never on a race over
its jobs' promises: one already settled answers every race at once, the loop never yields, and the
main process ran out of heap within seconds on the beta's ~500 images. An original held by the
database is read in 4 MB slices (`readFromDatabase`), since node-postgres turns a whole `bytea` into
a hex string twice its size and doubles its read buffer to fit it. The queue is in memory rather than the scheduler's job table because the copies are on THIS
instance's disk: a job claimed by another instance would fill the wrong cache. What a restart loses,
the reconcile finds.

**What gets a copy.** `kind = image`, a PNG/JPEG/WebP/GIF, with a stored width over 320 px. SVG never.
An animated GIF or WebP is caught when its bytes are read (`isAnimatedImage`) and every width is
marked `.orig` — served as the original from then on. Each copy is EXIF-rotated, sRGB, metadata
stripped, never enlarged, under Sharp's default pixel limit (the decompression-bomb guard). Lossy WebP
at `files.variants.quality` (80), except a PNG that is palette-based or has at most 8192 distinct
colours in a 256 px nearest-neighbour sample (a screenshot, a diagram), which is lossless so text stays
sharp. A copy that comes out no smaller than the original is not kept: a zero-byte `.orig` marker says
the original is the file for that width.

**The cache** is `<dataPath>/cache/variants/<id[0:2]>/<id>-<updatedAt ms>-w<width>.webp` (or `.orig`),
written atomically, with its own ceiling `files.variants.cacheMaxSize` (1 GiB) and its own
oldest-first sweep — not the file cache's directory or budget. A file-cache entry is refilled for the
price of a read, a copy for seconds of CPU; one shared oldest-first budget would let a burst of ordinary
reads evict copies that the encoders would then have to make again. The reconcile stops queuing at 90 %
of the ceiling, so a budget too small for the wiki's images fills on demand instead of churning.

**Invalidation is the key plus three calls**, all in `models/assets.ts`:

- a replace (upload overwrite, editor save, import overwrite) bumps `updatedAt`, and `dropCachedContent`
  drops the old copies; the new ones are queued
- a delete, and a folder delete (`deleteOrphaned`), drop them through `dropCachedContent`
- a rename or move bumps `updatedAt` without touching the bytes, so `moveAsset` drops only the file
  cache (`dropFileCache`) and **carries** the copies to the new key (`variants.rekey`) — no re-encode.
  A folder renamed or moved above a file changes neither id nor `updatedAt`, so nothing is touched.
- the maintenance "flush caches" purges the copies too; the reconcile remakes them

**Serving** (`controllers/files.ts`). The read check runs first and unchanged; `?w=` is looked at only
after it, so a reader without `read:assets` gets the same 404 as for the original. Then:

| Situation | Answer |
| --------- | ------ |
| copy on disk | the WebP, `ETag "<id>-<updatedAt>-w<width>"`, the usual `private, max-age=600, must-revalidate` |
| `.orig` marker (animated, unreadable, original smaller) | the original, exactly as without `?w=` |
| no copy yet | the original, `Cache-Control: private, no-cache`, `ETag "…-w<width>-original"`, and a copy queued |
| width not on the image's ladder, not a number, a non-raster file, SVG, or a forced download | the original, as without `?w=` — never a 400, never an encode |

The pending answer may be kept but is revalidated on every use, and its ETag can never match the
copy's, so the first request after the copy lands gets the copy. A width off the ladder gets the
original rather than 400 because a page's `srcset` is rendered from the image as it was: replace it
with a narrower one and the old widths stay in the HTML until the page is rendered again. With direct
access (a signed-URL redirect), a copy present is still streamed from the local cache, and a pending
one's redirect is sent `no-cache`.

**No Sharp, no copies.** A miss checks the extension before queuing, and so does every job; without
it nothing is queued or made, and `?w=` is answered with the original exactly as without it.

**HA.** Each instance has its own copies. The scheduled run lands on whichever instance claims it, so
over time each is visited; the rest is made on demand, one miss per width per instance.
