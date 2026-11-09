/**
 * draw.io diagrams in a page's markdown source, in the `diagram` fence Wiki.js 2.x wrote them in: the
 * SVG draw.io exports (`xmlsvg`, the drawing embedded in the root `content` attribute), as base64.
 *
 * Pure functions over the source's lines, for the editor's Insert Diagram action -- see
 * `useDiagramFenceEditing`. The renderer reads the same fence in `renderers/shared`.
 */

/**
 * The `diagram` fence around a line, if any: `{ startLine, endLine, svg }`, with `svg` the drawing the
 * fence's base64 body decodes to (null when the body is not base64 of UTF-8 text).
 *
 * Walked from the top of the source, tracking fences the way a renderer reads them, so that a `diagram`
 * opener inside some other fence is text and a closer is matched to the opener it belongs to. A fence
 * that is never closed does not count: there is no end to replace.
 *
 * @param {string[]} lines The page source, split into lines.
 * @param {number} lineNumber 1-based, as the editor counts.
 * @returns {{ startLine: number, endLine: number, svg: string|null }|null} The opener's and the
 *          closer's lines, 1-based, to be handed straight to the editor.
 */
export function diagramFenceAt(lines, lineNumber) {
  let open = null
  for (let line = 1; line <= lines.length; line++) {
    const text = lines[line - 1]
    if (!open) {
      // -> Tilde fences are tracked too, so a diagram opener quoted inside one is not taken for real
      const opener = /^ {0,3}(`{3,}|~{3,})\s*(\S*)/.exec(text)
      if (opener && !(opener[1][0] === '`' && opener[2].includes('`'))) {
        open = {
          line,
          mark: opener[1][0],
          ticks: opener[1].length,
          isDiagram: opener[1][0] === '`' && opener[2] === 'diagram'
        }
      }
    } else if (new RegExp(`^ {0,3}\\${open.mark}{${open.ticks},}\\s*$`).test(text)) {
      if (open.isDiagram && open.line <= lineNumber && lineNumber <= line) {
        // -> The lines between opener and closer, as one string: line breaks are whitespace too
        const body = lines
          .slice(open.line, line - 1)
          .join('')
          .replace(/\s+/g, '')
        let svg = null
        try {
          svg = base64ToText(body)
        } catch {
          // -> Left null: the caller says so rather than opening an empty drawing over it
        }
        return { startLine: open.line, endLine: line, svg }
      }
      open = null
    }
  }
  return null
}

/** Base64 of UTF-8 bytes, to text. `atob` alone gives one character per byte. */
export function base64ToText(base64) {
  return new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  )
}

/** Text to base64 of its UTF-8 bytes, in chunks so a large drawing does not overflow the call stack. */
export function textToBase64(text) {
  const bytes = new TextEncoder().encode(text)
  const CHUNK_SIZE = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE))
  }
  return btoa(binary)
}

/** A `diagram` fence holding a drawing, as the editor writes it. */
export function diagramFence(svg) {
  return `\`\`\`diagram\n${textToBase64(svg)}\n\`\`\``
}
