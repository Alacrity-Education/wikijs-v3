import { LitElement, html, svg, css, nothing } from 'lit'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { resolveFilePath } from '../shared/files.js'
import { DarkMode } from '../shared/theme.js'

/**
 * The named colours, picked to read against green soldermask and bare copper alike — the same ones
 * the Pillow workflow this block replaces drew with, so an annotated photo looks the same whichever
 * way it was made.
 */
const PALETTE = {
  blue: '#5096ff',
  red: '#ff5050',
  orange: '#ff9628',
  yellow: '#ffd23c',
  green: '#50e678',
  purple: '#b57bff',
  cyan: '#40d8e8',
  pink: '#ff78c8',
  white: '#ebebeb',
  black: '#141414'
}

/**
 * The order ids take colours in when they name none: one colour per thing, with no colour written
 * anywhere in the fence. White and black are left out — they are what a shape with no id is, and
 * what everything is outlined in.
 */
const ID_COLOURS = ['blue', 'red', 'orange', 'yellow', 'green', 'purple', 'cyan', 'pink'].map(
  (name) => PALETTE[name]
)

/** The dark under every stroke and around every text, so an annotation reads on any background. */
const HALO = 'rgba(12, 14, 20, 0.85)'

/**
 * The thinnest a stroke may be drawn on screen, in CSS pixels. Everything else is scaled up with it.
 *
 * Taken from the figure that read well: a 900-unit space shown 436 px wide (55 % of the column) draws
 * its default `W/250` = 3.6-unit stroke at 3.6 × 436 / 900 ≈ 1.75 px. The same picture at 20 % was
 * 158 px wide, drew that stroke at 0.6 px and shrank the discs and labels to match — unreadable. So a
 * picture shown smaller than that keeps the annotations at that size, and the picture is what shrinks.
 */
const MIN_STROKE_PX = 1.75

/** The id written on a disc. Near-black rather than the halo colour: it sits on the disc's colour. */
const DISC_INK = '#141414'

/** The shapes a line may draw. What each takes after its name is read in `readPositionals`. */
const SHAPES = ['box', 'circle', 'pin', 'line', 'arrow', 'poly', 'tri', 'text']

/** The shapes drawn as a stroke, and so the ones `dashed` and `width` mean anything for. */
const STROKED = ['box', 'circle', 'pin', 'line', 'arrow', 'poly']

/**
 * Which shapes each option applies to. An option given to a shape it means nothing for is reported
 * rather than ignored: `r=4` on a circle is far more likely a radius written the wrong way than a
 * setting the author meant to have no effect.
 */
const OPTION_SHAPES = {
  color: SHAPES,
  dashed: STROKED,
  width: STROKED,
  r: ['box'],
  size: SHAPES,
  anchor: ['text'],
  bold: ['text'],
  label: SHAPES.filter((shape) => shape !== 'text'),
  at: SHAPES
}

const DIRECTIONS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0]
}

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/
const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))(%?)$/
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * A line's words, with a quoted string as one of them.
 *
 * A quote may open anywhere in a word — `label="CAN H"` is one token, `label=CAN H` — and `\` escapes
 * the character after it, so `"say \"hi\""` holds its quotes. Each token remembers where its first
 * quote opened (`quoteAt`, -1 for none): that is what tells `label="a=b"` apart from an option whose
 * key happens to be quoted, and a string the author meant as text from a word that happens to spell
 * a colour.
 */
function tokenize(text) {
  const tokens = []
  let i = 0
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++
      continue
    }
    let value = ''
    let quoteAt = -1
    while (i < text.length && !/\s/.test(text[i])) {
      const quote = text[i]
      if (quote !== '"' && quote !== "'") {
        value += text[i++]
        continue
      }
      if (quoteAt < 0) {
        quoteAt = value.length
      }
      i++
      let closed = false
      while (i < text.length) {
        if (text[i] === '\\' && i + 1 < text.length) {
          value += text[i + 1]
          i += 2
        } else if (text[i] === quote) {
          closed = true
          i++
          break
        } else {
          value += text[i++]
        }
      }
      if (!closed) {
        throw new Error('a quoted string is not closed')
      }
    }
    tokens.push({ value, quoteAt })
  }
  return tokens
}

/**
 * A length as written: a number in the coordinate space, or with `%` a share of the space's width
 * (or height, for the second half of a point). Resolved only when drawn, since the space is not known
 * until the picture has loaded.
 */
function parseLength(text) {
  const match = LENGTH.exec(text)
  return match ? { value: Number(match[1]), percent: match[2] === '%' } : null
}

/** `420,300` or `12%,40%` — or null for anything else. */
function parsePoint(text) {
  const parts = text.split(',')
  if (parts.length !== 2) {
    return null
  }
  const x = parseLength(parts[0])
  const y = parseLength(parts[1])
  return x && y ? { x, y } : null
}

/** Whether a token was meant as a point, right or wrong — so a bad one is named as a bad point. */
function looksLikePoint(token) {
  return token.quoteAt < 0 && token.value.includes(',') && !token.value.includes('=')
}

/**
 * Read what comes after the shape's name, up to its first option.
 *
 * Returns the shape's fields and how many tokens they took; throws with the reason a line is wrong.
 */
function readPositionals(kind, tokens) {
  let used = 0
  const point = (what) => {
    const token = tokens[used]
    // -> A word with a digit in it was meant as the point and is named as a bad one; anything else
    //    (an option, a flag, nothing) means the point is missing
    if (!token || token.quoteAt >= 0 || token.value.includes('=') || !/\d/.test(token.value)) {
      throw new Error(`${kind} needs ${what}`)
    }
    const value = parsePoint(token.value)
    if (!value) {
      throw new Error(`"${token.value}" is not a point — write it x,y, as in 120,80 or 10%,25%`)
    }
    used++
    return value
  }

  switch (kind) {
    case 'box':
      return { points: [point('two opposite corners'), point('two opposite corners')], used }
    case 'pin':
      return { points: [point('a centre')], used }
    case 'circle': {
      const points = [point('a centre')]
      const token = tokens[used]
      let radius = null
      if (token && token.quoteAt < 0 && LENGTH.test(token.value)) {
        radius = parseLength(token.value)
        used++
      }
      return { points, radius, used }
    }
    case 'line':
    case 'arrow':
    case 'poly': {
      const least = kind === 'poly' ? 3 : 2
      const points = []
      while (tokens[used] && looksLikePoint(tokens[used])) {
        points.push(point('points'))
      }
      if (points.length < least) {
        throw new Error(`${kind} needs at least ${least} points, got ${points.length}`)
      }
      return { points, used }
    }
    case 'tri': {
      const points = [point('a position')]
      const token = tokens[used]
      if (!token || !DIRECTIONS[token.value]) {
        throw new Error('tri needs a direction after its position: up, down, left or right')
      }
      used++
      return { points, direction: token.value, used }
    }
    case 'text': {
      const points = [point('a position')]
      const token = tokens[used]
      if (!token || token.quoteAt !== 0) {
        throw new Error('text needs its string in quotes after the position: text 10,20 "label"')
      }
      used++
      return { points, text: token.value, used }
    }
  }
}

/**
 * A colour as an author may write one: a palette name, or any CSS colour. Checked against the
 * browser's own idea of a colour where there is a browser to ask; outside one (the parser's tests)
 * anything is let through, and the SVG simply ignores what it cannot paint.
 */
function readColour(value) {
  if (PALETTE[value]) {
    return PALETTE[value]
  }
  const supports = globalThis.CSS?.supports
  if (!value || (supports && !globalThis.CSS.supports('color', value))) {
    throw new Error(`"${value}" is not a colour`)
  }
  return value
}

/** A positive number, for a width, a radius or a font size. */
function readSize(key, value) {
  if (!NUMBER.test(value) || Number(value) <= 0) {
    throw new Error(`${key} has to be a positive number, got "${value}"`)
  }
  return Number(value)
}

/**
 * Read the options at the end of a line into `shape.options`.
 *
 * A key with `=` is an option with a value, a bare word a flag or a colour. The last of the same
 * option wins, as it would in an attribute list.
 */
function readOptions(kind, tokens) {
  const options = {}
  for (const token of tokens) {
    const { value, quoteAt } = token
    const equals = value.indexOf('=')
    let key
    if (equals > 0 && (quoteAt < 0 || equals < quoteAt)) {
      key = value.slice(0, equals)
      const given = value.slice(equals + 1)
      switch (key) {
        case 'color':
        case 'colour':
          key = 'color'
          options.color = readColour(given)
          break
        case 'width':
        case 'r':
        case 'size':
          options[key] = readSize(key, given)
          break
        case 'anchor':
          if (!['start', 'middle', 'end'].includes(given)) {
            throw new Error(`anchor is start, middle or end, got "${given}"`)
          }
          options.anchor = given
          break
        case 'label':
          options.label = given
          break
        case 'at': {
          const point = parsePoint(given)
          if (!point) {
            throw new Error(`at needs a point, as in at=120,80, got "${given}"`)
          }
          options.at = point
          break
        }
        default:
          throw new Error(`unknown option "${key}"`)
      }
    } else if (quoteAt >= 0) {
      throw new Error(`unexpected string "${value}" — a label is written label="…"`)
    } else if (value === 'dashed' || value === 'bold') {
      key = value
      options[key] = true
    } else if (PALETTE[value] || HEX.test(value)) {
      key = 'color'
      options.color = PALETTE[value] ?? value
    } else {
      throw new Error(`unknown option "${value}"`)
    }
    if (!OPTION_SHAPES[key].includes(kind)) {
      throw new Error(`${key} does not apply to ${kind}`)
    }
  }
  return options
}

/**
 * Read an `annotations` fence.
 *
 * Every line is read on its own, and a line that cannot be read is reported — with its number and the
 * reason — and skipped, so that one typo leaves the rest of the figure standing rather than blanking
 * it. Line numbers count from the fence's first line, which is what an author sees in the editor
 * next to the fence.
 *
 * @param {string} source
 * @returns {{ space: { width: number, height: number } | null, shapes: object[], errors: { line: number, message: string }[] }}
 */
export function parseAnnotations(source) {
  const shapes = []
  const errors = []
  let space = null
  source.split('\n').forEach((raw, index) => {
    const line = index + 1
    const text = raw.trim()
    if (!text || text.startsWith('#') || text.startsWith('//')) {
      return
    }
    try {
      const tokens = tokenize(text)
      let at = 0
      if (tokens[0].value === 'space' && tokens[0].quoteAt < 0) {
        const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(tokens[1]?.value ?? '')
        if (tokens.length !== 2 || !match || !Number(match[1]) || !Number(match[2])) {
          throw new Error('space is written WIDTHxHEIGHT, as in space 1600x1200')
        }
        space = { width: Number(match[1]), height: Number(match[2]) }
        return
      }
      let id = null
      if (tokens[0].quoteAt < 0 && /^(?:\d+|[A-Za-z])$/.test(tokens[0].value)) {
        // -> `01` and `1` are the same entry of the legend, so they are the same id
        id = /^\d+$/.test(tokens[0].value) ? String(Number(tokens[0].value)) : tokens[0].value
        at = 1
      }
      const kind = tokens[at]?.value
      if (!kind) {
        throw new Error(`id ${id} needs a shape after it`)
      }
      if (!SHAPES.includes(kind) || tokens[at].quoteAt >= 0) {
        throw new Error(`unknown shape "${kind}" — one of ${SHAPES.join(', ')}`)
      }
      const rest = tokens.slice(at + 1)
      const { used, ...fields } = readPositionals(kind, rest)
      const options = readOptions(kind, rest.slice(used))
      shapes.push({ line, id, kind, ...fields, options })
    } catch (err) {
      errors.push({ line, message: err.message })
    }
  })
  return { space, shapes, errors }
}

/**
 * Which legend entry each id stands for, as a 0-based index.
 *
 * When every id is a number, id n is the n-th entry, so a fence can skip an entry or list its ids out
 * of order and still point at the right one. Otherwise — letters, or a mix — ids take the entries in
 * the order they first appear. The same index picks an id's colour, so a disc and its entry match.
 */
export function tieIds(shapes) {
  const order = []
  for (const shape of shapes) {
    if (shape.id !== null && !order.includes(shape.id)) {
      order.push(shape.id)
    }
  }
  const numeric = order.every((id) => /^\d+$/.test(id))
  return new Map(order.map((id, index) => [id, numeric ? Number(id) - 1 : index]))
}

/** A palette colour for a legend index, round again past the eighth. */
function idColour(index) {
  return ID_COLOURS[((index % ID_COLOURS.length) + ID_COLOURS.length) % ID_COLOURS.length]
}

/**
 * An attribute that means "off" when it says so — the converter `block-gallery` reads
 * `unlockAspectRatio` with, for the same reason: MDC writes every prop with a value, and Lit's own
 * Boolean converter reads any string at all as true, `interactive="false"` included.
 */
const boolean = {
  converter: {
    fromAttribute: (value) => value !== null && value !== 'false',
    toAttribute: (value) => (value ? 'true' : null)
  }
}

/**
 * A figure width as CSS: `60%` stays a share of the column, `480` or `480px` is pixels. Anything
 * else is null, and the figure keeps its default width — a size the author mistyped on the image is
 * not worth an error panel over a picture that is otherwise fine.
 */
function cssWidth(value) {
  const match = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(%|px)?\s*$/i.exec(value ?? '')
  if (!match || !(Number(match[1]) > 0)) {
    return null
  }
  return match[2] === '%' ? `${Number(match[1])}%` : `${Number(match[1])}px`
}

/**
 * The box a run of text is likely to take, for `bounds` — estimated, since nothing has been laid out
 * when it is asked: 0.6 em a character across, and 0.6 em either side of the line it is centred on.
 * Generous for most text, which is the side to err on when the answer decides whether a label is cut.
 */
function textBox(text, x, y, size, anchor) {
  const span = [...String(text)].length * size * 0.6
  const left = anchor === 'middle' ? x - span / 2 : anchor === 'end' ? x - span : x
  return [left, y - size * 0.6, left + span, y + size * 0.6]
}

/** A rounded number for an SVG attribute: sub-pixel precision is plenty, and the markup stays short. */
function n(value) {
  return Math.round(value * 100) / 100
}

/**
 * Block Annotated Image
 */
export class BlockAnnotatedImageElement extends LitElement {
  /**
   * Metadata for the admin area and the editor's block picker. Collected at build time into
   * `compiled/blocks.manifest.json`, which the server reads to register the block. Values must be
   * plain literals. See `props` in `block-index` for what the picker does with that list.
   */
  static definition = {
    block: 'annotated-image',
    name: 'Annotated Image',
    description:
      'Draws boxes, rings, arrows and labels over a picture, with a legend whose entries are markdown.',
    icon: 'image',
    /*
      Three things, in this order: the picture, the annotations in a fence, and the legend as a list.
      The picture is inside the block so the block owns it — the renderer resolves its path like any
      other — and the fence is what keeps markdown off the annotations, as with a diagram's source.
      The coordinates here are percentages so the starter draws something sensible on any picture.
    */
    template: `![What the picture shows](path/to/image.png)

\`\`\`annotations
1 box 10%,15% 40%,45%
2 circle 70%,60% 6%
2 arrow 90%,90% 75%,66%
\`\`\`

1. The part the **box** marks
2. The part the **ring** marks`,
    asciidocTemplate: `image::path/to/image.png[What the picture shows]

[source,annotations]
----
1 box 10%,15% 40%,45%
2 circle 70%,60% 6%
2 arrow 90%,90% 75%,66%
----

. The part the *box* marks
. The part the *ring* marks`,
    props: [
      {
        name: 'panel',
        type: 'select',
        label: 'Legend',
        options: ['below', 'right', 'left', 'above', 'none'],
        hint: 'Where the legend goes. Beside the picture falls below it on a narrow column.',
        default: 'below'
      },
      {
        name: 'scale',
        type: 'number',
        label: 'Scale',
        hint: 'Multiplies the default stroke, disc and text sizes.',
        default: 1
      },
      {
        name: 'width',
        type: 'string',
        label: 'Width',
        hint: "The figure's width: a percentage of the column, e.g. 60%, or pixels, e.g. 480. Empty follows the size written on the image, or the column."
      },
      {
        name: 'interactive',
        type: 'boolean',
        label: 'Interactive',
        hint: 'Whether hovering a legend entry or a shape highlights the pair. Off for a figure that should only be looked at.',
        // -> Stated, so that a toggle switched off and then on again writes nothing into the page
        default: true
      },
      {
        name: 'caption',
        type: 'string',
        label: 'Caption',
        hint: 'Shown under the picture.'
      },
      {
        name: 'align',
        type: 'select',
        label: 'Alignment',
        options: ['left', 'center'],
        default: 'left'
      }
    ]
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }

      /* -> The gap below the block. On this element rather than :host: see block-index. */
      .figure,
      .error {
        margin-bottom: 16px;
      }

      .figure {
        /* -> A figure's own indent and top margin, from the browser; the gap below is set above */
        margin-top: 0;
        margin-inline: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }
      .figure.is-center {
        align-items: center;
      }

      /*
        The container the panel placement is decided against: the column the block sits in. Stacked,
        it is also what a width given to the figure sizes (is-stacked below); beside, the frame
        stays the column and the width goes to the picture's grid track instead, so a side legend
        keeps the rest of the row rather than being squeezed under a small picture.
      */
      .frame {
        container-type: inline-size;
        width: 100%;
        max-width: 100%;
      }

      /*
        Stacked, the figure is no wider than the picture's own width, so a small screenshot is not
        blown up to the column — and the legend under it lines up with it. Beside, it takes the column.
      */
      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        width: 100%;
        max-width: var(--natural-width, 100%);
        border-radius: 5px;
        overflow: hidden;
      }
      .layout.is-right {
        grid-template-columns: minmax(0, 1fr) minmax(220px, 30%);
        max-width: none;
      }
      .layout.is-left {
        grid-template-columns: minmax(220px, 30%) minmax(0, 1fr);
        max-width: none;
      }
      /*
        Beside, the row is as tall as the taller of the two, and a picture smaller than its legend
        would leave the page showing under it: the whole row takes the legend's dark instead, with the
        picture at the top of its column (.picture is align-self: start).
      */
      .layout.is-right,
      .layout.is-left {
        background: #121620;
      }
      .figure.is-center .layout {
        margin-inline: auto;
      }
      .layout.is-left .legend,
      .layout.is-above .legend {
        order: -1;
      }
      @container (max-width: 640px) {
        .layout.is-right,
        .layout.is-left {
          grid-template-columns: minmax(0, 1fr);
          max-width: var(--natural-width, 100%);
        }
        .layout.is-left .legend {
          order: 0;
        }
      }
      /* -> A width the author gave is the width, however small the picture is: no natural cap */
      .frame.has-width .layout {
        max-width: none;
      }
      /* -> Stacked, it sizes the whole figure, but never below what a legend can be read in */
      .frame.has-width.is-stacked {
        width: var(--figure-width);
        min-width: min(100%, 240px);
      }
      /* -> Beside, it sizes the picture's track, and the legend takes the rest of the column */
      .frame.has-width .layout.is-right {
        grid-template-columns: minmax(0, var(--figure-width)) minmax(220px, 1fr);
      }
      .frame.has-width .layout.is-left {
        grid-template-columns: minmax(220px, 1fr) minmax(0, var(--figure-width));
      }
      @container (max-width: 640px) {
        .frame.has-width .layout.is-right,
        .frame.has-width .layout.is-left {
          grid-template-columns: minmax(0, 1fr);
        }
      }

      .picture {
        position: relative;
        align-self: start;
      }
      /* -> Only round an annotation that reaches past the picture: the legend's dark, so it reads as frame */
      .picture.is-padded {
        background: #121620;
      }
      .picture img {
        display: block;
        width: 100%;
        height: auto;
      }

      /*
        The SVG lets the pointer through to the picture, so it can still be right-clicked and saved;
        the shapes take it back, so they can be hovered.
      */
      .overlay {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: visible;
        font-family:
          system-ui,
          -apple-system,
          'Segoe UI',
          Roboto,
          sans-serif;
      }
      .shape {
        pointer-events: visiblePainted;
        transition: opacity 0.15s;
      }
      .shape.is-dim {
        opacity: 0.35;
      }
      /* -> A static figure: the pointer goes through every shape to the picture */
      .overlay.is-static .shape {
        pointer-events: none;
      }

      .missing {
        padding: 2rem 1rem;
        border: 1px dashed rgba(235, 235, 235, 0.4);
        border-radius: 5px;
        color: #ebebeb;
        text-align: center;
        font-size: 0.9em;
      }

      /*
        The legend is dark whatever the page theme: the palette was chosen against dark, and yellow on
        white is not a label.
      */
      .legend {
        margin: 0;
        background: #121620;
        padding: 8px;
        list-style: none;
        color: #ebebeb;
        font-size: 0.9em;
        line-height: 1.45;
      }
      .entry {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 6px 10px;
        border-left: 3px solid transparent;
        border-radius: 3px;
        outline: none;
        transition: background-color 0.15s;
      }
      .entry.has-id {
        cursor: default;
      }
      .entry.is-active,
      .entry.has-id:focus-visible {
        border-left-color: var(--c);
        background: rgba(255, 255, 255, 0.08);
      }
      .disc {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 1.6em;
        height: 1.6em;
        padding: 0 0.3em;
        box-sizing: border-box;
        border-radius: 0.8em;
        background: var(--c);
        /* -> DISC_INK, as on the picture's own discs */
        color: #141414;
        font-weight: 700;
        font-size: 0.85em;
        margin-top: 0.05em;
      }
      .entry-body {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .entry-body p {
        margin: 0;
      }
      .entry-body p + p {
        margin-top: 0.4em;
      }
      .entry-body a {
        color: #8fb8ff;
      }
      .entry-body code {
        padding: 0 0.25em;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.1);
        font-size: 0.9em;
      }

      .caption {
        color: #424242;
        font-size: 0.8em;
      }
      :host([dark]) .caption {
        color: rgba(255, 255, 255, 0.7);
      }

      .error {
        color: var(--q-negative, #c10015);
        border: 1px dashed color-mix(in srgb, currentColor 50%, transparent);
        border-radius: 5px;
        padding: 0.75rem 1rem;
      }
      .figure .error {
        align-self: stretch;
        margin: 0;
      }
      .error ul {
        margin: 0.5rem 0 0;
        padding-left: 1.25rem;
        opacity: 0.9;
        font-size: 0.85em;
      }
    `
  }

  static get properties() {
    return {
      /**
       * Where the legend goes: `below`, `right`, `left`, `above` or `none`
       * @type {string}
       */
      panel: { type: String },

      /**
       * Multiplies every default size: strokes, discs, labels, pins and triangles
       * @type {number}
       */
      scale: { type: Number },

      /**
       * Text shown under the figure
       * @type {string}
       */
      caption: { type: String },

      /**
       * Where the figure sits in the column, `left` or `center`
       * @type {string}
       */
      align: { type: String },

      /**
       * The figure's width: `60%` of the column, or `480` pixels. Empty follows the image's own size
       * @type {string}
       */
      width: { type: String },

      /**
       * Whether pointing at a legend entry or a shape highlights the pair
       * @type {boolean}
       */
      interactive: boolean,

      // Internal Properties
      _src: { state: true },
      _natural: { state: true },
      _shown: { state: true },
      _failed: { state: true },
      _active: { state: true }
    }
  }

  constructor() {
    super()
    this.panel = 'below'
    this.scale = 1
    this.caption = ''
    this.align = 'left'
    this.width = ''
    this.interactive = true
    this._src = ''
    /** The `width` attribute the renderer wrote on the image, from markdown-it-imsize's `=WxH`. */
    this._imageWidth = ''
    this._alt = ''
    /** The picture's natural size, once it has loaded — the overlay is not drawn before. */
    this._natural = null
    this._failed = false
    /**
     * How many CSS pixels one unit of the space is shown at, from the picture box's width; null until
     * the box has been measured. See `_measure`.
     */
    this._shown = null
    this._resize = null
    this._measured = null
    /** The id being pointed at, from the legend or the picture; null when nothing is. */
    this._active = null
    this._parsed = { space: null, shapes: [], errors: [] }
    this._ties = new Map()
    /** Legend entries as the renderer wrote them: HTML that is already on the page. */
    this._entries = []
    this._hasBody = false
    // -> Puts `dark` on this element for the caption and the error list; the panel and the overlay
    //    are the same in both themes
    this._darkMode = new DarkMode(this)
  }

  firstUpdated() {
    /*
      Everything is read once, out of the light DOM the renderer left: the picture, the fence and the
      list. None of it is slotted, so none of it shows once this block is defined — and before then
      (or with no JavaScript) it is all still there to read, the fence as a dashed "not drawn" panel.
    */
    const image = this.querySelector('img')
    const fence = this.querySelector('pre')
    const list = this.querySelector('ol, ul')
    this._hasBody = Boolean(image || fence || list)

    // -> `textContent` undoes the escaping in the markup; not trimmed, so line numbers stay true
    this._parsed = parseAnnotations(fence?.textContent ?? '')
    this._ties = tieIds(this._parsed.shapes)
    this._entries = list
      ? [...list.children].filter((item) => item.tagName === 'LI').map((item) => item.innerHTML)
      : []

    if (image) {
      this._alt = image.getAttribute('alt') ?? ''
      // -> Only the width: the height would fight the picture's own aspect ratio, which is the one
      //    the overlay is measured against
      this._imageWidth = image.getAttribute('width') ?? ''
      // -> The renderer has normally written `/_files/…` already, which is left as it is
      this._src = resolveFilePath(image.getAttribute('src') ?? '')
    }
    // -> None of the above is reactive state on its own, and a block with no picture changes none that is
    this.requestUpdate()
  }

  connectedCallback() {
    super.connectedCallback()
    // -> Back in the page after being taken out of it: watch the same box again
    if (this._measured) {
      this._watch(this._measured)
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this._resize?.disconnect()
    this._resize = null
  }

  /**
   * Watch the picture box's width, which decides how large the annotations have to be drawn to stay
   * readable (`MIN_STROKE_PX`).
   *
   * `clientWidth` is the box's own width, which the column, the `width` prop and the grid track
   * decide. The padding this block adds round an annotation past the edge only moves the picture
   * inside that width, so the measurement never depends on what it is then used to draw — there is
   * no loop to settle.
   */
  _watch(box) {
    this._measured = box
    this._resize?.disconnect()
    this._resize = new ResizeObserver(() => this._measure())
    this._resize.observe(box)
  }

  _measure() {
    const width = this._parsed.space?.width ?? this._natural?.width
    const box = this._measured?.clientWidth
    if (!width || !box) {
      return
    }
    const shown = box / width
    // -> Only a real change redraws; a layout that has settled reports the same width over and over
    if (!this._shown || Math.abs(shown - this._shown) / this._shown > 0.005) {
      this._shown = shown
    }
  }

  updated(changed) {
    // -> The box exists from the render after the body was read, and again after a failed picture
    const box = this.renderRoot.querySelector('.picture')
    if (box && box !== this._measured) {
      this._watch(box)
    }
    // -> The natural size is what the scale is taken against when the fence declares no space
    if (changed.has('_natural')) {
      this._measure()
    }
    // -> A picture already in the cache may have loaded before Lit attached the listener
    if (changed.has('_src') && this._src) {
      const img = this.renderRoot.querySelector('.picture img')
      if (img?.complete && img.naturalWidth) {
        this._onLoad({ target: img })
      }
    }
  }

  _onLoad(event) {
    const { naturalWidth, naturalHeight } = event.target
    if (naturalWidth && naturalHeight) {
      this._natural = { width: naturalWidth, height: naturalHeight }
      this._failed = false
    }
  }

  /*
    Pointing, focusing and tapping all set the one active id. Hover is taken from the pointer events of
    a mouse only: a touch screen fires a hover just before its tap, which would set the id and have the
    tap clear it again at once. A tap toggles instead, which is the only way a touch reader can light
    an entry up and leave it lit.
  */
  _enter(id, event) {
    if (event.pointerType === 'mouse') {
      this._active = id
    }
  }

  _leave(id, event) {
    if (event.pointerType === 'mouse' && this._active === id) {
      this._active = null
    }
  }

  _tap(id, event) {
    if (event.pointerType !== 'mouse') {
      this._active = this._active === id ? null : id
    }
  }

  _blur(id) {
    if (this._active === id) {
      this._active = null
    }
  }

  /**
   * The colour each id is drawn in, which is the colour of the shape carrying its disc — so the
   * legend's disc is the picture's disc, even when the author gave the id a colour of their own.
   */
  _idColours() {
    const colours = new Map()
    for (const shape of this._parsed.shapes) {
      if (shape.id !== null && (!colours.has(shape.id) || colours.get(shape.id).fromText)) {
        colours.set(shape.id, {
          colour: this._colourOf(shape),
          fromText: shape.kind === 'text'
        })
      }
    }
    return new Map([...colours].map(([id, { colour }]) => [id, colour]))
  }

  _colourOf(shape) {
    if (shape.options.color) {
      return shape.options.color
    }
    return shape.id === null ? PALETTE.white : idColour(this._ties.get(shape.id))
  }

  /**
   * The overlay, in the coordinate space of the fence: `space` if it declares one, the picture's
   * natural size if not. `preserveAspectRatio="none"` stretches it exactly as the picture is
   * stretched, so a space measured on a preview of another shape still lands where it should.
   */
  _overlay() {
    const { space, shapes } = this._parsed
    const width = space?.width ?? this._natural.width
    const height = space?.height ?? this._natural.height
    const scale = Number.isFinite(this.scale) && this.scale > 0 ? this.scale : 1
    // -> Every default is a share of the width, so a 4000 px photo and an 800 px screenshot match
    /*
      The unit is the larger of the space as scaled and the unit at which a `unit / 250` stroke is
      drawn at exactly `MIN_STROKE_PX` on screen — so a picture shown small keeps annotations it
      can be read with, and `scale` still enlarges a figure that is above that floor already.
      Before the box has been measured, the first paint, it is the scaled space alone.
    */
    const unit = this._shown
      ? Math.max(width * scale, (MIN_STROKE_PX * 250) / this._shown)
      : width * scale
    const sizes = {
      stroke: unit / 250,
      discText: unit / 60,
      label: unit / 45,
      pin: unit / 70,
      tri: unit / 60,
      /*
        A disc as small as its id allows, so a single digit fills it the way it fills a badge:
        half the old diameter for one character, two thirds for two, the old size for three or more.
      */
      disc: (id) => {
        const chars = String(id ?? '').length
        return unit / (chars <= 1 ? 80 : chars === 2 ? 60 : 40)
      }
    }
    const length = (value, of) => (value.percent ? (value.value / 100) * of : value.value)
    const at = (point) => [length(point.x, width), length(point.y, height)]

    // -> The first shape of an id carries its disc; a text never does, its text being its label
    const discOwners = new Set()
    const seen = new Set()
    for (const shape of shapes) {
      if (shape.id !== null && shape.kind !== 'text' && !seen.has(shape.id)) {
        seen.add(shape.id)
        discOwners.add(shape)
      }
    }

    /*
      The extent of everything drawn, in the same units as the shapes, so the picture can be padded
      out to hold an annotation placed past its edge — a label beside a part at the rim, a disc on a
      box drawn round the whole board. Each shape and mark adds its own boxes through `grow`.
    */
    // -> Seeded with the picture less the breathing room below, so a fence inside it pads nothing
    const room = sizes.stroke
    const bounds = [room, room, width - room, height - room]
    const grow = (x0, y0, x1, y1) => {
      bounds[0] = Math.min(bounds[0], x0)
      bounds[1] = Math.min(bounds[1], y0)
      bounds[2] = Math.max(bounds[2], x1)
      bounds[3] = Math.max(bounds[3], y1)
    }

    // -> A static figure never highlights, whatever was set before it was made static
    const active = this.interactive ? this._active : null
    const outlines = []
    const marks = []
    for (const shape of shapes) {
      const drawn = this._shape(shape, { sizes, at, length, width, grow })
      const group = (content) => {
        const dim = active !== null && shape.id !== active
        return shape.id === null || !this.interactive
          ? svg`<g class="shape ${dim ? 'is-dim' : ''}">${content}</g>`
          : svg`<g
              class="shape ${dim ? 'is-dim' : ''}"
              @pointerenter="${(event) => this._enter(shape.id, event)}"
              @pointerleave="${(event) => this._leave(shape.id, event)}"
              @click="${(event) => this._tap(shape.id, event)}">${content}</g>`
      }
      outlines.push(group(drawn.body))
      const mark = this._mark(shape, drawn, discOwners.has(shape), sizes, at, grow)
      if (mark) {
        marks.push(group(mark))
      }
    }

    // -> One stroke of breathing room, so a halo does not end exactly on the edge it was kept inside
    const pad = {
      top: Math.max(0, room - bounds[1]),
      right: Math.max(0, bounds[2] + room - width),
      bottom: Math.max(0, bounds[3] + room - height),
      left: Math.max(0, room - bounds[0])
    }
    const across = width + pad.left + pad.right
    const down = height + pad.top + pad.bottom

    // -> Discs and labels over every outline, so a later box never runs through an earlier label
    return {
      style: this._padding(pad, across, width, height),
      svg: svg`<svg
        class="overlay ${this.interactive ? '' : 'is-static'}"
        viewBox="${n(-pad.left)} ${n(-pad.top)} ${n(across)} ${n(down)}"
        preserveAspectRatio="none"
        role="img"
        aria-label="${this._alt || 'Annotated image'}">${outlines}${marks}</svg>`
    }
  }

  /**
   * The picture box's padding, for annotations that reach past the picture.
   *
   * Every percentage padding resolves against the containing block's WIDTH, the vertical ones
   * included — which is what makes this exact: the picture box is `across` units wide, the image in
   * its content box `width` of them, so each side's share of `across` is its share of the box. A
   * vertical pad is then scaled by how much taller a unit is than it is wide, which is 1 unless a
   * `space` of another shape is stretched onto the picture. The overlay, absolutely placed, already
   * measures against the padding box, so with the viewBox moved out to match nothing else changes.
   */
  _padding(pad, across, width, height) {
    if (!pad.top && !pad.right && !pad.bottom && !pad.left) {
      return ''
    }
    const tall = this._natural.height / this._natural.width / (height / width)
    const share = (units, factor = 1) => `${((units * factor) / across) * 100}%`
    return `padding: ${share(pad.top, tall)} ${share(pad.right)} ${share(pad.bottom, tall)} ${share(pad.left)}`
  }

  /**
   * One shape's outline, in two passes — a wide dark stroke, then the coloured one over it — and the
   * point its disc goes to when `at` does not say otherwise.
   */
  _shape(shape, { sizes, at, length, width, grow }) {
    const colour = this._colourOf(shape)
    const stroke = shape.options.width ?? sizes.stroke
    const halo = stroke * 2
    const points = shape.points.map(at)
    // -> Half of the two passes together: the coloured stroke and the dark one under it
    const reach = (stroke + stroke + halo) / 2
    const around = ([x, y], r) => grow(x - r, y - r, x + r, y + r)
    if (
      shape.kind !== 'text' &&
      shape.kind !== 'tri' &&
      shape.kind !== 'circle' &&
      shape.kind !== 'pin'
    ) {
      for (const point of points) {
        around(point, reach)
      }
    }
    // -> In multiples of the stroke, so a thicker line has longer dashes rather than dots
    const dash = shape.options.dashed ? `${n(stroke * 3)} ${n(stroke * 2)}` : nothing
    const cap = shape.options.dashed ? 'butt' : 'round'
    const twice = (draw) => svg`${draw(HALO, stroke + halo)}${draw(colour, stroke)}`

    switch (shape.kind) {
      case 'box': {
        const [[x1, y1], [x2, y2]] = points
        const x = Math.min(x1, x2)
        const y = Math.min(y1, y2)
        const rx = shape.options.r ?? stroke * 1.5
        return {
          body: twice(
            (paint, w) => svg`<rect
              x="${n(x)}" y="${n(y)}" width="${n(Math.abs(x2 - x1))}" height="${n(Math.abs(y2 - y1))}"
              rx="${n(rx)}" fill="none" stroke="${paint}" stroke-width="${n(w)}"
              stroke-dasharray="${dash}" stroke-linejoin="round" />`
          ),
          anchor: [x, y],
          colour
        }
      }
      case 'circle':
      case 'pin': {
        const [[cx, cy]] = points
        const r = shape.radius ? length(shape.radius, width) : sizes.pin
        around([cx, cy], r + reach)
        return {
          body: twice(
            (paint, w) => svg`<circle
              cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="${paint}"
              stroke-width="${n(w)}" stroke-dasharray="${dash}" />`
          ),
          anchor: [cx + r * Math.SQRT1_2, cy - r * Math.SQRT1_2],
          colour
        }
      }
      case 'line':
      case 'poly': {
        const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(y)}`).join(' ')
        return {
          body: twice(
            (paint, w) => svg`<path
              d="${d}${shape.kind === 'poly' ? ' Z' : ''}" fill="none" stroke="${paint}"
              stroke-width="${n(w)}" stroke-dasharray="${dash}" stroke-linecap="${cap}"
              stroke-linejoin="round" />`
          ),
          anchor: points[0],
          colour
        }
      }
      case 'arrow': {
        /*
          The head is drawn as a triangle of its own rather than a <marker>: a marker scales with the
          stroke it sits on, so the dark under-pass would get a head half again the size of the
          coloured one. The line stops at the head's base, so a wide stroke does not poke out of its tip.
        */
        const tip = points.at(-1)
        const [px, py] = points.at(-2)
        const dx = tip[0] - px
        const dy = tip[1] - py
        const span = Math.hypot(dx, dy)
        let head = nothing
        let line = points
        if (span > 0) {
          const ux = dx / span
          const uy = dy / span
          const long = Math.min(stroke * 4.5, span)
          const half = stroke * 2.5
          const base = [tip[0] - ux * long, tip[1] - uy * long]
          const corners = [
            tip,
            [base[0] - uy * half, base[1] + ux * half],
            [base[0] + uy * half, base[1] - ux * half]
          ]
          const triangle = corners.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')
          for (const corner of corners) {
            around(corner, halo / 2)
          }
          head = svg`<polygon points="${triangle}" fill="${HALO}" stroke="${HALO}"
              stroke-width="${n(halo)}" stroke-linejoin="round" />
            <polygon points="${triangle}" fill="${colour}" />`
          line = [
            ...points.slice(0, -1),
            [base[0] + ux * stroke * 0.5, base[1] + uy * stroke * 0.5]
          ]
        }
        const d = line.map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(y)}`).join(' ')
        const path = (paint, w) => svg`<path
          d="${d}" fill="none" stroke="${paint}" stroke-width="${n(w)}"
          stroke-dasharray="${dash}" stroke-linecap="${cap}" stroke-linejoin="round" />`
        return {
          // -> Both under-passes first, so the dark of the head does not cover the coloured line
          body: svg`${path(HALO, stroke + halo)}${head}${path(colour, stroke)}`,
          anchor: points[0],
          colour
        }
      }
      case 'tri': {
        const [[x, y]] = points
        const [ux, uy] = DIRECTIONS[shape.direction]
        const size = sizes.tri
        const half = size * 0.6
        around([x, y], size)
        const tip = [x + (ux * size) / 2, y + (uy * size) / 2]
        const base = [x - (ux * size) / 2, y - (uy * size) / 2]
        const triangle = [
          tip,
          [base[0] - uy * half, base[1] + ux * half],
          [base[0] + uy * half, base[1] - ux * half]
        ]
          .map(([px, py]) => `${n(px)},${n(py)}`)
          .join(' ')
        return {
          body: svg`<polygon points="${triangle}" fill="${colour}" stroke="${HALO}"
            stroke-width="${n(sizes.stroke * 2)}" stroke-linejoin="round" paint-order="stroke" />`,
          // -> Behind it, on the side it points away from, so the disc never hides what it points at
          anchor: [
            x - ux * (size / 2 + sizes.disc(shape.id) + sizes.stroke),
            y - uy * (size / 2 + sizes.disc(shape.id) + sizes.stroke)
          ],
          colour
        }
      }
      case 'text': {
        const [[x, y]] = points
        const size = shape.options.size ?? sizes.label
        grow(...textBox(shape.text, x, y, size, shape.options.anchor ?? 'middle'))
        return {
          body: this._text(shape.text, x, y, {
            colour,
            size,
            halo: sizes.stroke * 2,
            anchor: shape.options.anchor ?? 'middle',
            weight: shape.options.bold ? 700 : 600
          }),
          anchor: null,
          colour
        }
      }
    }
  }

  /** A text with a dark halo drawn behind its letters, so it reads on copper and on silkscreen. */
  _text(text, x, y, { colour, size, halo, anchor, weight, ink }) {
    return svg`<text
      x="${n(x)}" y="${n(y)}" font-size="${n(size)}" font-weight="${weight}"
      text-anchor="${anchor}" dominant-baseline="central" fill="${ink ?? colour}"
      stroke="${halo ? HALO : 'none'}" stroke-width="${n(halo)}" stroke-linejoin="round"
      paint-order="stroke">${text}</text>`
  }

  /**
   * The disc of an id and the label of a shape, at the shape's anchor or where `at` puts them.
   * A label beside a disc starts past the disc; one without starts at the anchor itself.
   */
  _mark(shape, drawn, hasDisc, sizes, at, grow) {
    if (shape.kind === 'text') {
      return null
    }
    const anchor = shape.options.at ? at(shape.options.at) : drawn.anchor
    const parts = []
    const radius = sizes.disc(shape.id)
    if (hasDisc) {
      const outer = radius + sizes.stroke
      grow(anchor[0] - outer, anchor[1] - outer, anchor[0] + outer, anchor[1] + outer)
      parts.push(svg`<circle cx="${n(anchor[0])}" cy="${n(anchor[1])}" r="${n(radius)}"
        fill="${drawn.colour}" stroke="${HALO}" stroke-width="${n(sizes.stroke)}" />`)
      parts.push(
        this._text(shape.id, anchor[0], anchor[1], {
          size: sizes.discText,
          halo: 0,
          anchor: 'middle',
          weight: 700,
          ink: DISC_INK
        })
      )
    }
    if (shape.options.label) {
      const gap = sizes.stroke * 2
      const x = anchor[0] + (hasDisc ? radius + gap : gap)
      const size = shape.options.size ?? sizes.label
      grow(...textBox(shape.options.label, x, anchor[1], size, 'start'))
      parts.push(
        this._text(shape.options.label, x, anchor[1], {
          colour: drawn.colour,
          size,
          halo: sizes.stroke * 2,
          anchor: 'start',
          weight: 600
        })
      )
    }
    return parts.length ? parts : null
  }

  /**
   * The legend, one entry per list item. An entry is tied to the id whose index it is (`tieIds`);
   * one with no id is shown without a disc and takes no part in the highlighting. On a static figure
   * (`interactive` off) no entry does: each keeps its disc, but takes no focus and hears no pointer.
   */
  _legend() {
    const byIndex = new Map([...this._ties].map(([id, index]) => [index, id]))
    const colours = this._idColours()
    return html`<ol class="legend">
      ${this._entries.map((entry, index) => {
        const id = byIndex.get(index) ?? null
        if (id === null || !this.interactive) {
          return html`<li class="entry" style="${id === null ? '' : `--c: ${colours.get(id)}`}">
            ${id === null ? null : html`<span class="disc" aria-hidden="true">${id}</span>`}
            <div class="entry-body">${unsafeHTML(entry)}</div>
          </li>`
        }
        return html`<li
          class="entry has-id ${this._active === id ? 'is-active' : ''}"
          style="--c: ${colours.get(id)}"
          tabindex="0"
          @pointerenter="${(event) => this._enter(id, event)}"
          @pointerleave="${(event) => this._leave(id, event)}"
          @focus="${() => (this._active = id)}"
          @blur="${() => this._blur(id)}"
          @click="${(event) => this._tap(id, event)}">
          <span class="disc" aria-hidden="true">${id}</span>
          <div class="entry-body">${unsafeHTML(entry)}</div>
        </li>`
      })}
    </ol>`
  }

  _errors() {
    const { errors } = this._parsed
    if (errors.length < 1) {
      return null
    }
    return html`<div class="error">
      ${errors.length === 1 ? 'One line' : `${errors.length} lines`} of the annotations could not be
      read, and ${errors.length === 1 ? 'is' : 'are'} not drawn:
      <ul>
        ${errors.map((error) => html`<li>Line ${error.line}: ${error.message}</li>`)}
      </ul>
    </div>`
  }

  render() {
    /*
      Nothing at all until the body has been read, which `firstUpdated` does after this first
      render — an `img` rendered without a source fetches the page itself and fails to load.
    */
    if (!this.hasUpdated) {
      return null
    }
    if (!this._src) {
      return html`<div class="error">
        ${
          this._hasBody
            ? 'This block has no picture. Put an image first in its body: ![What it shows](path/to/image.png)'
            : 'This block is empty. Its body is a picture, an ```annotations fence and a list for the legend.'
        }
      </div>`
    }
    const panel = ['below', 'right', 'left', 'above', 'none'].includes(this.panel)
      ? this.panel
      : 'below'
    const showLegend = panel !== 'none' && this._entries.length > 0
    // -> Drawn first, since the picture box's padding depends on how far the annotations reach
    const overlay = this._natural && !this._failed ? this._overlay() : null
    // -> Whether a width sizes the picture's track (a legend beside it) or the whole figure
    const side = showLegend && (panel === 'right' || panel === 'left')
    const naturalWidth = this._natural && !this._failed ? `${this._natural.width}px` : null
    // -> The prop first, then the size written on the image; neither leaves the column's width
    const width = cssWidth(this.width) ?? cssWidth(this._imageWidth)
    return html`
      <figure
        class="figure ${this.align === 'center' ? 'is-center' : ''}"
        style="${naturalWidth ? `--natural-width: ${naturalWidth}` : ''}">
        <div
          class="frame ${width ? 'has-width' : ''} ${side ? '' : 'is-stacked'}"
          style="${width ? `--figure-width: ${width}` : ''}">
          <div class="layout is-${showLegend ? panel : 'none'}">
            <div
              class="picture ${overlay?.style ? 'is-padded' : ''}"
              style="${overlay?.style ?? ''}">
              ${
                this._failed
                  ? html`<div class="missing">
                      ${this._alt || 'The picture could not be loaded.'}
                    </div>`
                  : html`<img
                      src="${this._src}"
                      alt="${this._natural ? '' : this._alt}"
                      @load="${this._onLoad}"
                      @error="${() => (this._failed = true)}" />`
              }
              ${overlay?.svg ?? null}
            </div>
            ${showLegend ? this._legend() : null}
          </div>
        </div>
        ${this._errors()}
        ${this.caption ? html`<figcaption class="caption">${this.caption}</figcaption>` : null}
      </figure>
    `
  }
}

window.customElements.define('block-annotated-image', BlockAnnotatedImageElement)
