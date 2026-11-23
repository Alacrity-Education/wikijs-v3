import fs from 'node:fs/promises'
import { attachmentDisposition, isNoteImagesPath } from '../helpers/common.ts'
import { VARIANT_WIDTH_PARAM } from '../helpers/imageVariants.ts'
import { requestUserId } from '../helpers/requester.ts'
import { deliveryOf } from '../models/assets.ts'
import type { FastifyInstance } from 'fastify'

/**
 * How long a browser may keep a file before asking again.
 *
 * Short, and revalidated: unlike a thumbnail, what sits at a path is not fixed — deleting a file and
 * uploading another under the same name puts different bytes behind the same URL. `private`, because
 * the reply depends on who asked: a shared cache holding one reader's copy of a file the rules put
 * behind an account would hand it to the next reader along.
 */
const FILE_CACHE = 'private, max-age=600, must-revalidate'

/**
 * How long a browser may keep a redirect to a signed URL.
 *
 * Half of the link's own lifetime, so that a cached redirect cannot outlive the URL it points at — a
 * reader holding one of those has a broken image until their cache gives it up, and no way to force
 * the issue. Never longer than an ordinary file would have been cached for anyway.
 */
/**
 * Fork: how the original is cached when it stands in for a scaled-down copy that is not made yet.
 *
 * The browser may keep it, but must ask again before each use: the URL is the copy's, and once the copy
 * exists the next request has to get it rather than whatever was stored under that URL the first time.
 */
const PENDING_VARIANT_CACHE = 'private, no-cache'

/**
 * Fork: the width asked for by `?w=`, or null when none was, or not as a plain number.
 *
 * Not a width on the image's ladder is answered with the original rather than refused: a page renders
 * its `srcset` from the image as it was, and the file may since have been replaced by a narrower one
 * whose ladder stops sooner -- a 400 there would be a broken image until the page is rendered again.
 */
function requestedWidth(query: Record<string, unknown> | undefined): number | null {
  const raw = query?.[VARIANT_WIDTH_PARAM]
  return typeof raw === 'string' && /^\d{1,5}$/.test(raw) ? Number.parseInt(raw, 10) : null
}

function directAccessCacheSeconds(expiresInSeconds: number): number {
  return Math.max(1, Math.min(600, Math.floor(expiresInSeconds / 2)))
}

/**
 * _files Routes
 *
 * How a page's content points at an uploaded file: `/_files/<folder>/<name.ext>`, which is the path
 * the file manager shows and what the editors write into a page.
 *
 * Addressed by path rather than by ID so that what an author reads in their own markdown is the file
 * they picked, and so that content carries nothing instance-specific. The cost is the other half of
 * that bargain: renaming or moving a file leaves the pages that pointed at it pointing at nothing.
 *
 * Public in the sense that `_site` and `_thumb` are — no session is required — but not unguarded:
 * assets are addressed by the same rules as the pages they sit among, so every request is judged
 * against `read:assets` for the path it asked for.
 *
 * Fork: `?w=<width>` asks for an image's scaled-down WebP copy (`helpers/imageVariants.ts`), after the
 * same check as the original and never instead of it. A copy that is not there yet is not made here:
 * the original is sent, marked not to be kept as the copy, and the copy is queued for the background
 * encoders (`models/assetVariants.ts`). A width the image has no copy at, a file that is not a still
 * raster image, or one the site forces to download, ignores the parameter.
 *
 * Every image on every page comes through here, so neither half of the lookup normally reaches the
 * database: the path resolves out of memory and the bytes stream off the local disk cache. See the
 * assets model for what that caches and when it lets go of it.
 */
async function routes(app: FastifyInstance) {
  app.get<{ Params: { '*': string }; Querystring: Record<string, string> }>(
    '/*',
    {
      schema: {
        summary: 'An uploaded file, by its path, or an image scaled down to one of its copy widths',
        tags: ['Assets'],
        querystring: {
          type: 'object',
          properties: {
            [VARIANT_WIDTH_PARAM]: {
              type: 'string',
              description:
                "The width of the scaled-down WebP copy to send instead. Ignored unless it is one of the image's copy widths."
            }
          }
        }
      }
    },
    async (req, reply) => {
      const site = await WIKI.models.sites.getSiteByHostname({ hostname: req.hostname })
      if (!site) {
        return reply.notFound('Site not found')
      }

      const asset = await WIKI.models.assets.resolveAssetPath(site.id, req.params['*'] ?? '')
      /*
      A live note's image is not judged by the page rules for its path, which nobody writes for its
      folder and which answer no there whatever they say (`checkAccess`). It is the note's own footing
      instead: anybody who may read the site's live notes -- a guest, where the guests group holds
      `read:notes` -- and holds the URL, its random name being what nobody can guess.
    */
      const isNoteImage = Boolean(asset && isNoteImagesPath(asset.folderPath))
      // -> Not readable is answered as not there, so the URL cannot be used to probe for files
      if (
        !asset ||
        (isNoteImage
          ? !WIKI.models.liveNotes.permissionsFor(
              {
                userId: requestUserId(req),
                actor: WIKI.models.groups.actorForRequest(req)
              },
              site.id
            ).read
          : !WIKI.models.groups.checkAccess(
              WIKI.models.groups.actorForRequest(req),
              'read:assets',
              {
                siteId: site.id,
                path: asset.folderPath ? `${asset.folderPath}/${asset.fileName}` : asset.fileName,
                locale: asset.locale
              }
            ))
      ) {
        return reply.notFound('File not found')
      }

      const { download, csp } = deliveryOf(asset)

      // -> Fork: a scaled-down copy. Asked only after the read check above, which it shares in full
      const width = download ? null : requestedWidth(req.query)
      const variant = width ? await WIKI.models.assets.variants.lookup(asset, width) : null
      if (variant?.type === 'copy') {
        const handle = await fs.open(variant.filePath, 'r').catch(() => null)
        if (handle) {
          const copyEtag = `"${asset.id}-${asset.updatedAt.getTime()}-w${width}"`
          reply.header('ETag', copyEtag)
          reply.header('Cache-Control', FILE_CACHE)
          reply.header('X-Content-Type-Options', 'nosniff')
          if (csp) {
            reply.header('Content-Security-Policy', csp)
          }
          if (req.headers['if-none-match'] === copyEtag) {
            await handle.close()
            return reply.code(304).send()
          }
          const { size } = await handle.stat()
          reply.header('Content-Length', size)
          return reply.type('image/webp').send(handle.createReadStream({ autoClose: true }))
        }
        // -> Swept between the lookup and the open: served as a copy not made yet, and made again
        WIKI.models.assets.variants.request(asset)
      }
      const isPendingVariant = variant !== null && variant.type !== 'original'

      /*
      Hand the reader straight to the store where the site has said to, which is the whole point of
      keeping content in one: the bytes never touch this server. Resolved before the ETag below,
      because the two are answers to different questions — an ETag says "you already have the bytes",
      and there are no bytes here to have.
    */
      const directUrl = await WIKI.models.storage.directAccessUrlFor(
        { ...asset, siteId: site.id },
        { contentType: asset.mimeType, ...(download ? { downloadAs: asset.fileName } : {}) }
      )
      if (directUrl) {
        // -> Cacheable, but for less than the link lives: a redirect kept past its URL's expiry is a
        //    reader stuck on a dead link until their cache lets go of it. Half is the simple safe
        //    fraction, and it still takes most of a page's images off this server on a reload.
        reply.header(
          'Cache-Control',
          isPendingVariant
            ? PENDING_VARIANT_CACHE
            : `private, max-age=${directAccessCacheSeconds(directUrl.expiresInSeconds)}`
        )
        return reply.redirect(directUrl.url, 302)
      }

      /*
      The ID and the timestamp together, because either one alone lies: a file replaced at the same
      path is a different asset under the same URL, and one edited in place keeps its ID.
    */
      /*
      Fork: standing in for a copy, the original gets an ETag of its own, so that a revalidation once
      the copy exists can never be answered 304 with these bytes -- the copy's ETag is checked first,
      above, and this one only ever matches while the copy is still missing.
    */
      const etag = isPendingVariant
        ? `"${asset.id}-${asset.updatedAt.getTime()}-w${width}-original"`
        : `"${asset.id}-${asset.updatedAt.getTime()}"`
      reply.header('ETag', etag)
      reply.header('Cache-Control', isPendingVariant ? PENDING_VARIANT_CACHE : FILE_CACHE)
      // -> The bytes came from a user, so the browser must take the type at its word rather than
      //    looking for something more interesting in them
      reply.header('X-Content-Type-Options', 'nosniff')
      // -> A live note's SVG included, which anybody holding the note's key can add
      if (csp) {
        reply.header('Content-Security-Policy', csp)
      }
      if (req.headers['if-none-match'] === etag) {
        return reply.code(304).send()
      }

      const content = await WIKI.models.assets.readContent(asset)
      if (!content) {
        // -> The path resolved to a row that is no longer there, so the resolution was a stale one
        WIKI.models.assets.forgetPath(site.id, asset.folderPath, asset.fileName)
        return reply.notFound('File not found')
      }

      if (download) {
        reply.header('Content-Disposition', attachmentDisposition(asset.fileName))
      }
      // -> Set by hand because the body may be a stream, which Fastify would otherwise send chunked —
      //    and a download with no length is a download with no progress bar
      reply.header('Content-Length', content.size)
      return reply.type(asset.mimeType).send(content.body)
    }
  )
}

export default routes
