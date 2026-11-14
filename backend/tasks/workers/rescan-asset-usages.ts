import { assetUsages } from '../../models/assetUsages.ts'

/**
 * Rebuild the asset usage index: where every uploaded file is referenced, page by page and position
 * by position. See `models/assetUsages.ts`.
 *
 * Every three hours from `SYSTEM_SCHEDULE`, and when somebody presses "Rescan usage index" in the file
 * manager. **In a worker thread**, because it reads the source of every page in the instance: on the
 * main thread that is the event loop not serving pages for the duration. The model needs nothing but
 * the database, which `ensureDb` opens.
 */
export async function task(): Promise<void> {
  await WIKI.ensureDb!()
  WIKI.logger.info('Rescanning asset usages...')
  const total = await assetUsages.rescan()
  WIKI.logger.info(`Recorded ${total} asset reference(s) [ COMPLETED ]`)
}
