import fastifyStatic from '@fastify/static'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'

/**
 * _blocks Routes — the compiled web components a page's blocks are drawn by.
 *
 * Two places answer from here and the URL does not say which: `/_blocks/block-diagram.js` is a file
 * in `blocks/compiled` when the block ships with the wiki, and a file unpacked from a row in the
 * database when somebody imported it. The first segment of the path names the block, and that is the
 * whole of the decision — everything a block brings is under `block-<key>.js`,
 * `block-<key>.worker.js` or `block-<key>/`, which is the namespace `helpers/wkblock.ts` holds an
 * imported package to precisely so that this can be settled by looking at one segment.
 *
 * Which means the answer depends on WHICH SITE was asked, since a custom block belongs to one site,
 * and two sites on an instance may each have imported a different block under the same key. The
 * frontend has no site in hand when it loads a block — it reads a tag out of the page and asks for it
 * — so the hostname is what resolves it, the same lookup every request hook does.
 *
 * This is a plain route rather than a second `@fastify/static` registration because a static plugin
 * claims `/_blocks/*` outright, leaving nothing to ask the question in front of it. The plugin is
 * still registered, with `serve: false`, for `reply.sendFile` and everything it knows about ranges,
 * conditional requests and content types.
 */
async function routes(app: FastifyInstance) {
  const builtInRoot = path.join(WIKI.ROOTPATH, 'blocks/compiled')

  app.register(fastifyStatic, {
    root: builtInRoot,
    serve: false
  })

  app.get<{ Params: { '*': string } }>('/*', async (req, reply) => {
    const filePath = req.params['*'] ?? ''
    const block = blockKeyOf(filePath)
    const siteId = WIKI.sitesMappings[req.hostname] || WIKI.sitesMappings['*']

    const customRoot =
      block && siteId ? await WIKI.models.blocks.servingPathFor(siteId, block) : null

    /*
      Revalidated on every request rather than held for an hour, built-in and custom alike. The file
      names are the same across versions -- `block-xyz.js` is `block-xyz.js` however many times it has
      been re-imported, and a built-in's is the same after every upgrade of the wiki too -- so a cached
      copy outlives the code it was: an instance upgraded under a reader kept drawing every block with
      the previous release's component for up to an hour, and the fix somebody uploaded a custom block
      for was not live. An ETag turns nearly every one of these into an empty 304, which is what makes
      that affordable; the module itself is kept by the browser for the life of the page regardless.
    */
    reply.header('Cache-Control', 'public, no-cache')
    return reply.sendFile(filePath, customRoot ?? builtInRoot, { cacheControl: false })
  })
}

/**
 * The block a served path belongs to, or null for a path that names no block.
 *
 * `block-pdf.js`, `block-pdf.worker.js` and `block-pdf/cmaps/Adobe-Japan1-0.bcmap` are all the pdf
 * block. Anything else — `blocks.manifest.json`, a shared chunk of the built-in build — is nobody's,
 * and is a built-in file by elimination.
 */
function blockKeyOf(filePath: string): string | null {
  const first = filePath.split('/')[0]
  if (!first?.startsWith('block-')) {
    return null
  }
  const stem = first.endsWith('.worker.js')
    ? first.slice(0, -'.worker.js'.length)
    : first.endsWith('.js')
      ? first.slice(0, -'.js'.length)
      : first
  return /^block-[a-z0-9][a-z0-9-]*$/.test(stem) ? stem.slice('block-'.length) : null
}

export default routes
