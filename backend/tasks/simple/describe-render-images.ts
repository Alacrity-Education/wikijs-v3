import type { TaskContext } from '../../core/scheduler.ts'

/** How many pages are read per query. A render is parsed only when it names a `/_files/` address. */
const BATCH_SIZE = 50

/**
 * Fork: bring every stored render's pictures up to date -- `srcset`, `sizes`, their own size and lazy
 * loading (`helpers/renderImages.ts`) -- without a browser and without re-rendering anything.
 *
 * A reconcile rather than a migration: run on a schedule, it is what gives the renders saved before
 * the step existed their `srcset`, and what catches a picture uploaded after the page that names it, a
 * file replaced at another size, or a site whose content width changed. A pass over a wiki that is
 * already up to date writes nothing: the step gives the same render back for the same render and the
 * same files, and a page is written only when one of its pictures changed (`describeStoredImages`).
 *
 * Works through the pages in id order, a batch at a time, and answers `signal` between batches by
 * handing where it got to to a fresh job -- the slicing `renderPages` does -- so a large wiki takes as
 * many runs of the scheduler's task timeout as it needs and never blocks one.
 */
export async function task(
  payload: { afterId?: string | null } | null,
  { signal }: TaskContext
): Promise<void> {
  let afterId: string | null = payload?.afterId ?? null
  let updated = 0
  do {
    const batch = await WIKI.models.rendering.describeStoredImages(afterId, BATCH_SIZE)
    afterId = batch.lastId
    updated += batch.updated
  } while (afterId && !signal?.aborted)

  if (afterId) {
    await WIKI.scheduler.addJob({
      task: 'describeRenderImages',
      payload: { afterId },
      maxRetries: 0
    })
  }
  if (updated > 0) {
    WIKI.logger.info(`Described the pictures of ${updated} stored page renders.`)
  }
}
