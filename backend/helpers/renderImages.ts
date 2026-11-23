import { and, eq, inArray, or } from 'drizzle-orm'
import { assets as assetsTable, tree as treeTable } from '../db/schema.ts'
import { encodeTreePath } from './common.ts'
import { variantUrl, variantWidths, VARIANT_WIDTH_PARAM } from './imageVariants.ts'
import type * as cheerio from 'cheerio'
import type { Element } from 'domhandler'

/**
 * Fork: what a stored render says about each of its pictures, so that a reader's browser fetches the
 * size it needs rather than the file as it was uploaded.
 *
 * A page's images are written `/_files/<path>` (`fileSrc` in `frontend/src/renderers/shared.js` makes
 * every form an author can write into that), and the file behind each one is an asset whose pixel size
 * is on its row. Knowing that, `describeImages` gives every such `<img>`:
 *
 *  - **`srcset`** -- the scaled-down copies `/_files/` serves at `?w=` (`helpers/imageVariants.ts` is
 *    that contract), plus the original at its own width. Only for a raster the copies are made of, and
 *    only when it is wider than the narrowest copy: never an SVG (no pixels to scale), a GIF (likely
 *    animated, see `VARIANT_MIME_TYPES`), an image whose width is not on its row, or a `src` that
 *    names no asset of this site.
 *  - **`sizes`** -- `auto` first, for an image that is lazy: Chromium then picks from the width the
 *    image is actually laid out at, which is the only way a picture in a card or a column gets a copy
 *    its own size. What follows is the width of the article column at each of the page layout's
 *    breakpoints, which is what a browser without `auto` (and every eager image) sizes by -- see
 *    `columnSizes`.
 *  - **`width` and `height`** -- the file's own, so the box is the right shape before a byte has
 *    arrived. `_page-contents.scss` draws a picture `max-width: 100%; height: auto`, so the pair is an
 *    aspect ratio and a ceiling, not a size: the picture is drawn exactly as it was without them. Never
 *    over a size the author wrote (`![](x.png =300x)` arrives as `width="300"`), and marked
 *    `data-natural-size` so that nothing reading the element later takes them for one. Not for an
 *    SVG, whose row holds a size its `<img>` may not be drawn at.
 *  - **`loading="lazy"`** for every picture but the page's first -- the first is likely in view and
 *    the one the page is judged by -- and **`decoding="async"`** for all of them.
 *
 * A block that needs the picture's true pixels (it measures `naturalWidth`, or copies the address)
 * opts out in its own code: `useOriginalImage` in `blocks/shared/images.js`, which marks the element
 * `data-original-image` and takes off again what this wrote: the `srcset`, `sizes`, and a `width` and
 * `height` marked `data-natural-size`. An `<img>` that already carries that
 * attribute when it gets here is left alone, which is the same opt-out for an author writing HTML.
 *
 * **The same render in, the same render out.** A render that has been through here once comes through
 * again unchanged, because a stored render goes through `postProcess` again whenever a page's
 * properties are saved without an editor, and `describeRenderImages` (the reconcile task) runs over
 * every stored render: what this added is recognised and rebuilt in the same order rather than piled
 * on. The size it wrote carries `data-natural-size`; the `srcset` it wrote is told from one an author
 * wrote by its candidates, which are all the `src` itself or the `src` at a `?w=` -- `isOwnSrcset`.
 * An author's `srcset` is never touched, and neither is the rest of that image.
 */

/** Where a page's uploaded files are served from. */
const FILES_PREFIX = '/_files/'

/**
 * The formats `/_files/` makes copies of (see `.claude/rules/image-delivery.md`), less GIF: most GIFs
 * on a wiki are animations, whose every `?w=` is answered with the whole original, and nothing on the
 * asset's row says which ones are -- so a `srcset` would only have the browser fetch the same file
 * under another name as the window changes. An animated WebP has the same problem and is rare enough
 * to be let through.
 */
const VARIANT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

/** What this marks a picture as when it must load as the file it is -- see `useOriginalImage`. */
export const ORIGINAL_IMAGE_ATTRIBUTE = 'data-original-image'

/**
 * What says the `width` and `height` beside it are the file's own, written here, rather than a size
 * the author asked for: so that a later pass replaces them when the file changed, and so that a block
 * reading the picture (`useOriginalImage`) can tell the author's size from the file's.
 */
export const NATURAL_SIZE_ATTRIBUTE = 'data-natural-size'

/** An asset as a picture in a page needs it. */
export interface ImageAsset {
  mimeType: string
  width: number | null
  height: number | null
}

/**
 * The article column's width at each breakpoint of the page layout, widest viewport first, as CSS
 * lengths a `sizes` can hold. Measured in the browser off the stacked layout with its navigation
 * sidebar open (the usual page), as `.page-contents`' content box:
 *
 *  - from 1400px the navigation (255px) and the side column (300px) stand beside the article;
 *  - from 1200px the side column narrows to 200px (`$toc-narrow-max`);
 *  - from 750px the navigation is a drawer over the page and only the side column stands beside it;
 *  - below that the side column is a panel too (`$toc-overlay-max`), and only the padding is left --
 *    17px on a phone, 33px from 600px, written as the former since erring wide costs nothing.
 *
 * Under the theme's Centered width the column is held to `$content-centered-max-width` as well, so
 * each length is capped by it (`CENTERED_COLUMN_PX`). A page whose navigation is folded to its icon
 * rail has 200px more than this says, which only ever costs a step of sharpness on the page's first
 * picture, or in a browser without `sizes="auto"`.
 */
const COLUMN_BREAKPOINTS: { minWidth: number | null; column: string }[] = [
  { minWidth: 1400, column: 'calc(100vw - 588px)' },
  { minWidth: 1200, column: 'calc(100vw - 488px)' },
  { minWidth: 750, column: 'calc(100vw - 233px)' },
  { minWidth: null, column: 'calc(100vw - 17px)' }
]

/** The centred measure's content width (`$content-centered-max-width`), when the theme has one. */
const CENTERED_COLUMN_PX = 1000

/**
 * The fallback half of `sizes`: the column's width at each breakpoint, capped by what the author asked
 * the picture to be drawn at, and by the centred measure where the theme has one.
 */
function columnSizes(capPx: number | null, centered: boolean): string {
  return COLUMN_BREAKPOINTS.map(({ minWidth, column }) => {
    const caps = [capPx, centered ? CENTERED_COLUMN_PX : null].filter(
      (cap): cap is number => cap !== null
    )
    const length =
      caps.length > 0 ? `min(${caps.map((cap) => `${cap}px`).join(', ')}, ${column})` : column
    return minWidth === null ? length : `(min-width: ${minWidth}px) ${length}`
  }).join(', ')
}

/**
 * Where a `src` points among this site's files, as the folder and name the tree is keyed by, or null
 * for anything that is not a plain `/_files/` address of an original.
 */
function filePathOf(src: string): { folderPath: string; fileName: string } | null {
  if (!src.startsWith(FILES_PREFIX)) {
    return null
  }
  const queryAt = src.search(/[?#]/)
  const path = queryAt === -1 ? src : src.slice(0, queryAt)
  // -> A `src` that already asks for a copy is not an original to offer copies of
  if (
    queryAt !== -1 &&
    new URLSearchParams(src.slice(queryAt).split('#')[0]).has(VARIANT_WIDTH_PARAM)
  ) {
    return null
  }
  let segments: string[]
  try {
    segments = path.slice(FILES_PREFIX.length).split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
  const name = segments.pop()
  if (!name) {
    return null
  }
  return {
    folderPath: encodeTreePath(segments.join('/')),
    // -> As `assets.getAssetByPath` looks a name up: the tree keeps names lowercased
    fileName: name.toLowerCase().normalize('NFC')
  }
}

/** The key one asset is found under in the answer of `lookupImageAssets`. */
function keyOf(folderPath: string, fileName: string): string {
  return `${folderPath}\u0000${fileName}`
}

/**
 * The assets a set of `/_files/` addresses name on a site, in one query however many there are.
 *
 * The lookup `assets.getAssetByPath` makes, for many paths at once: a page may hold dozens of pictures,
 * and asking about each was a query per picture on every save. Where one path holds a file in several
 * locales, the site's primary locale's is the one a reader is served, so it is the one described.
 */
export async function lookupImageAssets(
  siteId: string,
  srcs: string[]
): Promise<Map<string, ImageAsset>> {
  const wanted = new Map<string, { folderPath: string; fileName: string }>()
  for (const src of srcs) {
    const path = filePathOf(src)
    if (path) {
      wanted.set(keyOf(path.folderPath, path.fileName), path)
    }
  }
  const found = new Map<string, ImageAsset>()
  if (wanted.size < 1) {
    return found
  }
  const primaryLocale = WIKI.sites[siteId]?.config?.locales?.primary ?? 'en'
  const fileNames = [...new Set([...wanted.values()].map((path) => path.fileName))]
  const rows = await WIKI.db
    .select({
      folderPath: treeTable.folderPath,
      fileName: treeTable.fileName,
      locale: treeTable.locale,
      mimeType: assetsTable.mimeType,
      meta: assetsTable.meta
    })
    .from(assetsTable)
    .innerJoin(treeTable, eq(treeTable.id, assetsTable.id))
    .where(
      and(
        eq(assetsTable.siteId, siteId),
        eq(treeTable.type, 'asset'),
        // -> Narrowed by name through the index first; the exact pairs are matched below
        inArray(treeTable.fileName, fileNames),
        or(
          ...[...wanted.values()].map((path) =>
            and(eq(treeTable.folderPath, path.folderPath), eq(treeTable.fileName, path.fileName))
          )
        )
      )
    )

  const byPath = new Map<string, { locale: string; asset: ImageAsset }>()
  for (const row of rows) {
    // -> ltree comes back as written, which is what `encodeTreePath` produced on the way in
    const key = keyOf(row.folderPath ?? '', row.fileName)
    const held = byPath.get(key)
    if (held && held.locale === primaryLocale) {
      continue
    }
    if (held && row.locale !== primaryLocale && held.locale < row.locale) {
      continue
    }
    const meta = (row.meta ?? {}) as Record<string, any>
    byPath.set(key, {
      locale: row.locale,
      asset: {
        mimeType: row.mimeType,
        width: Number.isFinite(meta.width) && meta.width > 0 ? meta.width : null,
        height: Number.isFinite(meta.height) && meta.height > 0 ? meta.height : null
      }
    })
  }
  for (const src of srcs) {
    const path = filePathOf(src)
    const hit = path && byPath.get(keyOf(path.folderPath, path.fileName))
    if (hit) {
      found.set(src, hit.asset)
    }
  }
  return found
}

/** The candidates of a `srcset`, as `[url, descriptor]` pairs. URLs here never hold a space. */
function parseSrcset(srcset: string): [string, string][] {
  return srcset
    .split(/,\s+/)
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .map((candidate) => {
      const [url, descriptor = ''] = candidate.split(/\s+/)
      return [url, descriptor]
    })
}

/**
 * Whether a `srcset` is one `describeImages` wrote: every candidate is the `src` itself or the `src`
 * at one of the copy widths, each described by its width.
 */
function isOwnSrcset(srcset: string, src: string): boolean {
  return parseSrcset(srcset).every(([url, descriptor]) => {
    const width = /^(\d+)w$/.exec(descriptor)?.[1]
    return Boolean(width) && (url === src || url === variantUrl(src, Number(width)))
  })
}

/**
 * Describe every `/_files/` picture in a render for the browser: see the top of this file.
 *
 * @returns Whether anything in the document changed, for a caller that stores only what did
 */
export async function describeImages($: cheerio.CheerioAPI, siteId: string): Promise<boolean> {
  const images = $(`img[src^="${FILES_PREFIX}"]`)
    .toArray()
    .filter((el) => $(el).attr(ORIGINAL_IMAGE_ATTRIBUTE) === undefined)
  if (images.length < 1) {
    return false
  }
  const before = images.map((el) => $.html(el)).join('')
  const assets = await lookupImageAssets(
    siteId,
    images.map((el) => $(el).attr('src') ?? '')
  )
  const centered = WIKI.sites[siteId]?.config?.theme?.contentWidth === 'centered'

  images.forEach((el, index) => describeImage($, el, assets, index === 0, centered))

  return images.map((el) => $.html(el)).join('') !== before
}

function describeImage(
  $: cheerio.CheerioAPI,
  el: Element,
  assets: Map<string, ImageAsset>,
  isFirst: boolean,
  centered: boolean
): void {
  const image = $(el)
  const src = image.attr('src') ?? ''
  const srcset = image.attr('srcset')

  // -> What this wrote last time comes off first, so that it is rebuilt in the same place
  if (srcset !== undefined) {
    if (!isOwnSrcset(srcset, src)) {
      // -> The author's own: theirs to size, theirs to load
      return
    }
    image.removeAttr('srcset').removeAttr('sizes')
  }
  if (image.attr(NATURAL_SIZE_ATTRIBUTE) !== undefined) {
    image.removeAttr('width').removeAttr('height').removeAttr(NATURAL_SIZE_ATTRIBUTE)
  }
  image.removeAttr('loading').removeAttr('decoding')

  const asset = assets.get(src)
  const isRaster = asset && asset.mimeType !== 'image/svg+xml'
  // -> A size the author wrote in pixels is as wide as the picture is ever drawn
  const authorWidth = /^\d+$/.test(image.attr('width') ?? '') ? Number(image.attr('width')) : null
  const authorSized = image.attr('width') !== undefined || image.attr('height') !== undefined
  if (isRaster && asset.width && asset.height && !authorSized) {
    image.attr('width', String(asset.width))
    image.attr('height', String(asset.height))
    image.attr(NATURAL_SIZE_ATTRIBUTE, '')
  }

  const lazy = !isFirst
  const widths =
    isRaster && VARIANT_MIME_TYPES.has(asset.mimeType) && !/\s/.test(src)
      ? variantWidths(asset.width)
      : []
  if (widths.length > 0) {
    const originalWidth = asset!.width!
    image.attr(
      'srcset',
      [
        ...widths.map((width) => `${variantUrl(src, width)} ${width}w`),
        `${src} ${originalWidth}w`
      ].join(', ')
    )
    const cap = authorWidth !== null && authorWidth < originalWidth ? authorWidth : null
    image.attr('sizes', `${lazy ? 'auto, ' : ''}${columnSizes(cap, centered)}`)
  }
  if (lazy) {
    image.attr('loading', 'lazy')
  }
  image.attr('decoding', 'async')
}
