import { decodeUrlPath, isPageUrl } from './common.ts'
import { segments } from './linkRewrite.ts'
import type { SourceSyntax } from './linkRewrite.ts'

/**
 * Finding the uploaded files a page's SOURCE refers to, and exactly where.
 *
 * Read from the source rather than the render, because the point is a position an editor can jump
 * to: the render has lost it (`stripEditorArtifacts` takes the line markers off before it is stored).
 * There is no markdown parser on this side, so a reference is found by the syntax around it, the way
 * `helpers/linkRewrite.ts` finds a link to repair -- and code is skipped the same way, by the same
 * `segments`, since an address inside a fence or a code span is an example of one and not a use.
 *
 * What an address MEANS is the renderer's to say, and this has to agree with it or a file in use
 * reads as unused. The rules are mirrored here from three places in the frontend, which is a fourth
 * copy of them (see `helpers/pageLinks.ts` for the third):
 *
 *   - a picture, `fileSrc` in `frontend/src/renderers/shared.js`: relative to the page's FOLDER, from
 *     the site root when it starts with a slash, and `/_files/` in front of either;
 *   - a link, `fileHref` beside it: the same, but only when its last segment names a file -- has an
 *     extension, and not one of the site's page extensions, which address a page;
 *   - a block's attribute, `resolveFilePath` in `blocks/shared/files.js`: always from the site root.
 *     Blocks differ in this (`block-pdf` reads a relative `src` against the page), so an attribute is
 *     looked up both ways, the page-relative reading first.
 *
 * Only addresses that come out under `/_files/` on this site are files. Everything else -- another
 * server, a `data:` URI, a page, one of the wiki's own `/_` routes -- is not looked at again.
 */

/** How a reference is written. Stored as `assetUsages.kind`. */
export type AssetUsageKind = 'image' | 'link' | 'html' | 'block' | 'url'

/** One reference found in a page, with where it is and what it resolves to. */
export interface AssetReference {
  kind: AssetUsageKind
  /** The address as written. */
  raw: string
  /** The file path below `/_files/`, lowercased, decoded and NFC-normalized as the tree keys it. */
  targetPath: string
  /** The file at that path, or null when there is none: a broken reference. */
  assetId: string | null
  startOffset: number
  endOffset: number
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

/** What a scan needs to know about the page and its site. */
export interface ScanContext {
  /** The page's path, without a leading slash: what a relative address resolves against. */
  pagePath: string
  siteId: string
  /** The site's page extensions, lowercase and without the dot. */
  pageExtensions: string[]
  /** Every hostname a site of this instance answers to, for addresses written as full URLs. */
  siteForHost: (hostname: string) => string | null
  /** The file at a path (as `targetPath` spells it) on the page's site, if there is one. */
  assetAt: (filePath: string) => string | null
}

/** How an address is read, which decides the candidate paths and whether a miss is worth a row. */
type Reading = 'image' | 'link' | 'attribute'

const FILES_PREFIX = '/_files/'

/** The placeholder origin relative addresses are resolved against; only the path survives. */
const PAGE_ORIGIN = 'http://page.invalid'

/** The longest address looked at. Past it, it is not a path anybody wrote by hand. */
const MAX_ADDRESS_LENGTH = 2048

/** How the tree keys a file path: lowercased and NFC-normalized, no empty segments. */
function treeKey(filePath: string): string {
  return filePath.split('/').filter(Boolean).join('/').toLowerCase().normalize('NFC')
}

/** The file path below `/_files/` that a URL path names, or null when it names no file there. */
function filesPath(urlPath: string): string | null {
  if (!urlPath.startsWith(FILES_PREFIX)) {
    return null
  }
  const rest = treeKey(decodeUrlPath(urlPath.slice(FILES_PREFIX.length)))
  return rest.length > 0 ? rest : null
}

/**
 * The paths an address could name, in the order the renderer would try them, and whether a miss on
 * all of them is a broken reference rather than something that simply is not a file.
 */
function candidatesFor(
  address: string,
  reading: Reading,
  ctx: ScanContext
): { paths: string[]; brokenIfMissing: boolean } | null {
  const value = address.trim()
  if (
    !value ||
    value.length > MAX_ADDRESS_LENGTH ||
    value.startsWith('#') ||
    value.startsWith('?') ||
    value.startsWith('//')
  ) {
    return null
  }

  // -> A full URL is a file only when it is `/_files/` on THIS site, as any server path is
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    if (!/^https?:/i.test(value)) {
      return null
    }
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return null
    }
    if (ctx.siteForHost(url.hostname.toLowerCase()) !== ctx.siteId) {
      return null
    }
    const path = filesPath(url.pathname)
    return path ? { paths: [path], brokenIfMissing: true } : null
  }

  // -> The wiki's own routes: `/_files/` is the one that holds files, and is taken as written
  if (value.startsWith('/_')) {
    const path = filesPath(value.split(/[?#]/)[0])
    return path ? { paths: [path], brokenIfMissing: true } : null
  }

  const folder = ctx.pagePath.split('/').slice(0, -1).join('/')
  let url: URL
  try {
    url = new URL(value, `${PAGE_ORIGIN}/${folder ? `${folder}/` : ''}`)
  } catch {
    return null
  }
  if (!isPageUrl(url.pathname)) {
    return null
  }
  const pageRelative = treeKey(decodeUrlPath(url.pathname))
  if (!pageRelative) {
    return null
  }

  if (reading === 'image') {
    return { paths: [pageRelative], brokenIfMissing: true }
  }

  // -> A link, or an attribute, is a file only when its name says so: no page or folder holds a dot
  const name = pageRelative.slice(pageRelative.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot < 1 || dot === name.length - 1 || ctx.pageExtensions.includes(name.slice(dot + 1))) {
    return null
  }
  if (reading === 'link') {
    return { paths: [pageRelative], brokenIfMissing: true }
  }

  // -> An attribute: the page-relative reading, then the root-relative one blocks use. Not recorded
  //    when neither is there -- an attribute holding a name with a dot is not necessarily a file
  const fromRoot = treeKey(decodeUrlPath(value.split(/[?#]/)[0]))
  return {
    paths: fromRoot && fromRoot !== pageRelative ? [pageRelative, fromRoot] : [pageRelative],
    brokenIfMissing: false
  }
}

/**
 * Whether the `]` at `close` closes a picture -- its `[` preceded by `!` -- rather than a link.
 * Bracket depth is counted, so the badge form `[![alt](img)](href)` reads its outer brackets as a
 * link around a picture.
 */
function isImageBracket(text: string, close: number): boolean {
  let depth = 0
  for (let i = close; i >= 0; i--) {
    const ch = text[i]
    if (ch === '\\') {
      continue
    }
    if (ch === ']') {
      depth++
    } else if (ch === '[') {
      depth--
      if (depth === 0) {
        return text[i - 1] === '!'
      }
    } else if (ch === '\n' && text[i - 1] === '\n') {
      // -> A blank line ends a paragraph, and no link spans one
      return false
    }
  }
  return false
}

/** One address found in the text, before it is resolved. */
interface Found {
  kind: AssetUsageKind
  reading: Reading
  raw: string
  start: number
}

/** Markdown inline destinations: `[text](addr)`, `![alt](addr "title")`, `[text](<addr>)`. */
const MD_DESTINATION = /\]\(\s*(?:<([^>\n]+)>|([^\s()<>]+))/g

/** A markdown reference definition, `[label]: addr`. */
const MD_REFERENCE = /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*<?([^\s>]+)/gm

/** AsciiDoc pictures and links: `image::addr[]`, `image:addr[]`, `link:addr[]`, `link:++addr++[]`. */
const ADOC_IMAGE = /\bimage::?([^\s[]+)\[/g
const ADOC_LINK = /\blink:(?:\+\+)?([^\s[+]+)(?:\+\+)?\[/g

/**
 * An attribute holding something that could be a path, in HTML or in a block's braces --
 * `<img src="…">`, `::block-pdf{src="…"}`. Any attribute name: blocks name theirs freely, and a value
 * that resolves to no file is not recorded (see `candidatesFor`).
 */
const ATTRIBUTE = /\b([a-zA-Z][\w-]*)\s*=\s*(["'])([^"'\n]+)\2/g

/** `/_files/…` standing anywhere, with or without the site in front: the catch-all. */
const FILES_URL = /(?:\bhttps?:\/\/[^\s/()<>"'[\]]+)?\/_files\/[^\s()<>"'[\]`]+/gi

/** An attribute's kind: inside a block's braces on its line, or HTML. */
function attributeKind(text: string, at: number): AssetUsageKind {
  const lineStart = text.lastIndexOf('\n', at - 1) + 1
  const before = text.slice(lineStart, at)
  return /:block-[a-z0-9-]*\{[^}]*$/.test(before) ? 'block' : 'html'
}

/** Every address in one stretch of non-code text, with its offset in that stretch. */
function findIn(text: string, syntax: SourceSyntax): Found[] {
  const found: Found[] = []

  if (syntax === 'markdown') {
    for (const m of text.matchAll(MD_DESTINATION)) {
      const raw = m[1] ?? m[2]
      const image = isImageBracket(text, m.index)
      found.push({
        kind: image ? 'image' : 'link',
        reading: image ? 'image' : 'link',
        raw,
        // -> The address's own offset: it ends the match, or sits just inside its closing `>`
        start: m.index + m[0].length - raw.length - (m[1] ? 1 : 0)
      })
    }
    for (const m of text.matchAll(MD_REFERENCE)) {
      found.push({
        kind: 'link',
        reading: 'link',
        raw: m[1],
        start: m.index + m[0].length - m[1].length
      })
    }
  } else {
    for (const m of text.matchAll(ADOC_IMAGE)) {
      found.push({
        kind: 'image',
        reading: 'image',
        raw: m[1],
        start: m.index + m[0].indexOf(m[1], 'image:'.length)
      })
    }
    for (const m of text.matchAll(ADOC_LINK)) {
      found.push({
        kind: 'link',
        reading: 'link',
        raw: m[1],
        start: m.index + m[0].indexOf(m[1], 'link:'.length)
      })
    }
  }

  for (const m of text.matchAll(ATTRIBUTE)) {
    const name = m[1].toLowerCase()
    const kind = attributeKind(text, m.index)
    const raw = m[3]
    const start = m.index + m[0].length - 1 - raw.length
    // -> An HTML picture's `src` is a picture to the renderer (`rewriteHtmlImages`), and its `href`
    //    a link; every other attribute, and every block attribute, is read both ways
    const reading: Reading =
      kind === 'html' && name === 'src'
        ? 'image'
        : kind === 'html' && name === 'href'
          ? 'link'
          : 'attribute'
    found.push({ kind, reading, raw, start })
  }

  // -> Last, and only where nothing above already stands: a destination or an attribute holding a
  //    `/_files/` URL is that, not a second reference to the same file
  const taken = found.map((f) => [f.start, f.start + f.raw.length])
  for (const m of text.matchAll(FILES_URL)) {
    // -> Punctuation ending the sentence the address stands in is not part of it, as linkify reads it
    const raw = m[0].replace(/[.,;:!?]+$/, '')
    const start = m.index
    const end = start + raw.length
    if (taken.some(([a, b]) => start < b && end > a)) {
      continue
    }
    found.push({ kind: 'url', reading: 'link', raw, start })
  }

  return found
}

/** 1-based line and column of every offset asked about, from the line starts of the text. */
function positionsIn(content: string): (offset: number) => { line: number; column: number } {
  const starts = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      starts.push(i + 1)
    }
  }
  return (offset) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }
    return { line: lo + 1, column: offset - starts[lo] + 1 }
  }
}

/**
 * Every reference to an uploaded file in a page's source, in the order they are written.
 *
 * A reference that resolves to no file is kept when the way it is written says it IS a file -- a
 * picture, a link whose name has an extension, a `/_files/` address -- since that is a broken
 * reference, the thing worth finding. One that is only possibly a file (a block attribute) is kept
 * only when a file is there.
 */
export function findAssetReferences(
  content: string,
  syntax: SourceSyntax,
  ctx: ScanContext
): AssetReference[] {
  const refs: AssetReference[] = []
  const positionOf = positionsIn(content)

  let base = 0
  for (const segment of segments(content, syntax)) {
    if (!segment.code) {
      for (const found of findIn(segment.text, syntax)) {
        const candidates = candidatesFor(found.raw, found.reading, ctx)
        if (!candidates) {
          continue
        }
        let targetPath = candidates.paths[0]
        let assetId: string | null = null
        for (const path of candidates.paths) {
          const id = ctx.assetAt(path)
          if (id) {
            targetPath = path
            assetId = id
            break
          }
        }
        if (!assetId && !candidates.brokenIfMissing) {
          continue
        }
        const startOffset = base + found.start
        const endOffset = startOffset + found.raw.length
        const start = positionOf(startOffset)
        const end = positionOf(endOffset)
        refs.push({
          kind: found.kind,
          raw: found.raw,
          targetPath,
          assetId,
          startOffset,
          endOffset,
          startLine: start.line,
          startColumn: start.column,
          endLine: end.line,
          endColumn: end.column
        })
      }
    }
    base += segment.text.length
  }

  return refs.sort((a, b) => a.startOffset - b.startOffset)
}
