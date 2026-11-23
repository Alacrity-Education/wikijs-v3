import type { TaskContext } from '../../core/scheduler.ts'

/**
 * Fork: make the scaled-down copies any image on this instance is missing or holds only for an older
 * version of the file -- the images an import or a storage sync brought in without passing through an
 * upload, copies the cache swept, and uploads made on another instance or before a restart dropped the
 * queue. See `assets.variants.reconcile`.
 *
 * Bounded by `files.variants.reconcileBudget`, and its encodes share the at-most-two encoder processes
 * with the after-upload path, so a run never holds more than that and the next run carries on where it
 * stopped. A run with nothing missing costs one query and one directory listing.
 */
export async function task(_payload: unknown, { signal }: TaskContext): Promise<void> {
  const result = await WIKI.models.assets.variants.reconcile({ signal })
  if (result.queued > 0 || result.measured > 0 || result.staleRemoved > 0) {
    WIKI.logger.info(
      `Image copies: checked ${result.checked} image(s), made copies of ${result.queued}, measured ${result.measured}, removed ${result.staleRemoved} stale [ OK ]`
    )
  }
}
