import { LitElement, html, css } from 'lit'
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import JSON5 from 'json5'
/*
  The package's own UMD build, not its `lib/` entry -- and by path, since `exports` names only `.`,
  `package.json` and `skins/*`.

  `lib/index.js` is the same code as plain CommonJS, but it `require`s two JSON files (its own
  `package.json`, for the version, and `char-width.json`, the glyph widths every label is measured
  with), and this build has no JSON plugin: rollup stops at the first one. The UMD build is that same
  `lib/index.js` put through esbuild by the package itself, with both files already inlined, so it
  carries the same exports -- `renderAny`, `onml` -- and moves with the version like the rest.
  Nothing in it touches `window` or `document` as it loads; only the page-scanning helpers it also
  exports (`processAll`, `renderWaveForm`) do, and nothing here calls them.
*/
import wavedrom from '../node_modules/wavedrom/wavedrom.unpkg.js'
/*
  The skins, straight from the package, so that a version bump brings its drawings with it.

  Each one is a browser script rather than a module -- `var WaveSkin=WaveSkin||{};WaveSkin.dark=[...]`
  -- but it ends in a guarded `module.exports = WaveSkin`, which is the half the commonjs plugin reads.
  The `var` is local to the module it is wrapped in, so every file hands back an object holding just
  its own skin under its own name, and nothing is written to `window`. No `globalThis.WaveSkin` shim
  is needed, and no copy of the arrays has to be kept in step here. `skinOf` below unwraps them.
*/
import defaultSkinModule from 'wavedrom/skins/default.js'
import darkSkinModule from 'wavedrom/skins/dark.js'
import narrowSkinModule from 'wavedrom/skins/narrow.js'
import narrowerSkinModule from 'wavedrom/skins/narrower.js'
import narrowererSkinModule from 'wavedrom/skins/narrowerer.js'
import lowkeySkinModule from 'wavedrom/skins/lowkey.js'
import { DarkMode } from '../shared/theme.js'

const { renderAny, onml } = wavedrom

/**
 * One skin's onml tree out of the object its script exported.
 *
 * Defensive about the interop on purpose: `default.js` names its skin `default`, which is also the
 * key an ES default import is unwrapped by, so depending on how the bundler reads the module the
 * import is either `{ default: [...] }` or the array itself.
 */
function skinOf(module, name) {
  return Array.isArray(module) ? module : module[name]
}

const SKINS = {
  default: skinOf(defaultSkinModule, 'default'),
  dark: skinOf(darkSkinModule, 'dark'),
  narrow: skinOf(narrowSkinModule, 'narrow'),
  narrower: skinOf(narrowerSkinModule, 'narrower'),
  narrowerer: skinOf(narrowererSkinModule, 'narrowerer'),
  lowkey: skinOf(lowkeySkinModule, 'lowkey')
}

/**
 * A number for the next drawing, so every one of them gets ids of its own.
 *
 * WaveDrom suffixes every id it writes with the index it is given -- `svgcontent_3`, `wavelane_0_3`
 * -- and nothing else keeps two diagrams apart. A shadow root already scopes them, but the same SVG
 * also turns up wherever the page is serialised, so they are made unique per page as block-diagram's
 * are. It starts at 1: see `primeLane` for what index 0 does.
 */
let drawingCount = 0

/**
 * Hand WaveDrom the one skin it is to draw in.
 *
 * `renderAny` takes a map of skins and picks from it itself -- `default`, unless the source names
 * another in `config.skin` -- so the skin this block resolved is the map's only entry, under
 * `default`. Which one that is gets decided in `_skinName`, where the source's `config.skin` is
 * weighed against the block's own prop.
 *
 * A copy, because WaveDrom writes the drawing INTO the skin it picks -- the size, the ids and the
 * lanes all land on that tree -- and the package's own arrays must stay as they shipped.
 */
function skinsFor(name) {
  return { default: structuredClone(SKINS[name]) }
}

/**
 * Set WaveDrom's lane geometry for the skin about to be drawn in.
 *
 * The brick size and label offsets live on one object shared by the whole library, and are only read
 * out of the skin when the index is 0 -- WaveDrom draws a page of diagrams at once and gives them all
 * the first one's geometry. Here every diagram has its own index and possibly its own skin, and the
 * narrow skins have a different brick, so an empty diagram is drawn at index 0 first to load the
 * right one. Drawing is synchronous, so nothing can come in between it and the drawing it is for.
 */
function primeLane(skins) {
  renderAny(0, { signal: [] }, skins)
}

/**
 * Read a WaveDrom source, with the same checks WaveDrom makes of one.
 *
 * WaveDrom itself `eval`s the source in the browser, which accepts anything JavaScript does. Not
 * here: the source is written by whoever may edit the page and run in the browser of whoever reads
 * it. JSON5 is what its own command-line tool parses with, and covers how sources are actually
 * written -- unquoted keys, single quotes, trailing commas, comments -- as well as plain JSON.
 */
function parseSource(text) {
  const source = JSON5.parse(text)
  if (Object.prototype.toString.call(source) !== '[object Object]') {
    throw new Error('The root has to be an object: { signal: [...] }')
  }
  if (source.signal) {
    if (!Array.isArray(source.signal)) {
      throw new Error('"signal" has to be an array: { signal: [...] }')
    }
  } else if (source.assign) {
    if (!Array.isArray(source.assign)) {
      throw new Error('"assign" has to be an array: { assign: [...] }')
    }
  } else if (!source.reg) {
    throw new Error('The source needs a "signal", "assign" or "reg" property.')
  }
  return source
}

/**
 * Block WaveDrom
 */
export class BlockWavedromElement extends LitElement {
  /**
   * Metadata for the admin area and the editor's block picker. Collected at build time into
   * `compiled/blocks.manifest.json`, which the server reads to register the block. Values must be
   * plain literals. See `props` in `block-index` for what the picker does with that list.
   */
  static definition = {
    block: 'wavedrom',
    name: 'WaveDrom',
    description: 'Draws a digital timing diagram from WaveDrom source.',
    icon: 'microchip',
    /*
      Fenced, for the same reason as block-diagram: markdown would otherwise reach the source first.
      `|` in a wave reads as a table cell, `<` and `>` as tags, `*` and `_` as emphasis, and the
      typographer curls the quotes JSON5 needs straight.
    */
    template: `\`\`\`wavedrom
{ signal: [
  { name: "clk",   wave: "p......." },
  { name: "req",   wave: "0.1..0.." },
  { name: "data",  wave: "x.345x..", data: ["A", "B", "C"] },
  { name: "ack",   wave: "0...1.0." }
]}
\`\`\``,
    /*
      The body is a source an author types, so it is edited as one: `BlockContentCode` puts the
      WaveDrom source on the left and this block, drawn from what is being typed, on the right. The
      key is resolved to a component by `BlockContentEditorOverlay`.
    */
    contentEditor: 'code',
    props: [
      {
        name: 'skin',
        type: 'select',
        label: 'Skin',
        options: ['auto', 'default', 'dark', 'narrow', 'narrower', 'narrowerer', 'lowkey'],
        hint: 'auto follows the page theme',
        default: 'auto'
      },
      {
        name: 'caption',
        type: 'string',
        label: 'Caption',
        hint: 'Shown under the diagram.'
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
      .diagram,
      .error {
        margin-bottom: 16px;
      }

      .diagram {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }
      .diagram.is-center {
        align-items: center;
      }

      /*
        WaveDrom writes the drawing's own width and height on the SVG, with a viewBox, so it keeps its
        size until the column is narrower than it and then shrinks to fit, in proportion.
      */
      svg {
        max-width: 100%;
        height: auto;
      }
      /* -> See _fitDarkSkin: the dark skin, asked for by name on a light page, gets a dark panel */
      :host(:not([dark])) svg.is-dark-skin {
        background: #1d1d1d;
        border-radius: 4px;
      }
      svg.is-inverted {
        filter: invert(1) hue-rotate(180deg);
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
        padding: 1rem;
        white-space: pre-wrap;
      }
      .error pre {
        margin: 0.75rem 0 0;
        color: inherit;
        opacity: 0.8;
        font-size: 0.85em;
        white-space: pre-wrap;
      }
    `
  }

  static get properties() {
    return {
      /**
       * WaveDrom skin, or `auto` to follow the reader's theme
       * @type {string}
       */
      skin: { type: String },

      /**
       * Text shown under the diagram
       * @type {string}
       */
      caption: { type: String },

      /**
       * Where the drawing sits in the column, `left` or `center`
       * @type {string}
       */
      align: { type: String },

      // Internal Properties
      _svg: { state: true },
      _error: { state: true }
    }
  }

  constructor() {
    super()
    this.skin = 'auto'
    this.caption = ''
    this.align = 'left'
    this._svg = ''
    this._error = ''
    /*
      `dark` on this element is what the caption colour keys off; the callback redraws the diagram,
      since a skin is a set of colours written into the SVG. Only `auto` has anything to follow, and
      only once there is a source, which `firstUpdated` reads.
    */
    this._darkMode = new DarkMode(this, {
      onChange: () => {
        if (this._source && this._themed) {
          this._draw()
        }
      }
    })
    /** The source, and whether it came out of a fence. Both read from the body once, on first render. */
    this._source = ''
    this._fenced = false
    /** Whether the current drawing depends on the page theme, so a theme change has to redraw it. */
    this._themed = false
  }

  /**
   * The skin to draw a source in.
   *
   * One chosen on the block wins. Under `auto` a skin named in the source's own `config.skin` is
   * honoured, as it would be anywhere else WaveDrom is drawn; failing that it is WaveDrom's own dark
   * skin on a dark page and its default one on a light page.
   */
  _skinName(source) {
    if (this.skin && this.skin !== 'auto' && SKINS[this.skin]) {
      return this.skin
    }
    if (SKINS[source.config?.skin]) {
      return source.config.skin
    }
    return this._darkMode.isDark ? 'dark' : 'default'
  }

  /**
   * Draw the source, or say why it could not be drawn.
   */
  _draw() {
    this._themed = !this.skin || this.skin === 'auto' || this.skin === 'dark'
    try {
      const source = parseSource(this._source)
      const skinName = this._skinName(source)
      // -> Each gets a copy of its own, since both are drawn into
      primeLane(skinsFor(skinName))
      const skins = skinsFor(skinName)
      const tree = renderAny(++drawingCount, source, skins)
      if (tree[0] === 'svg' && skinName === 'dark') {
        this._fitDarkSkin(tree, Boolean(source.signal))
      }
      this._svg = onml.stringify(tree)
      this._error = ''
    } catch (err) {
      this._svg = ''
      // -> JSON5 says what it could not read and at which line and column, which is the useful part
      this._error = `This diagram could not be drawn: ${err.message ?? err}`
      if (!this._fenced) {
        this._error +=
          '\n\nThe source has to go inside a fenced code block, or markdown rewrites it before this block sees it.'
      }
    }
  }

  /**
   * Make a drawing in the dark skin readable.
   *
   * WaveDrom lays a white rectangle under every timing diagram whatever the skin, so the dark skin's
   * white lines and labels are drawn white on white. That rectangle is cleared here and the SVG
   * marked, so that it sits on the page's own dark background -- or, on a light page where the skin
   * was asked for by name, on a dark panel the styles below give it.
   *
   * A register (`reg`) or assignment (`assign`) diagram has no skin at all: it comes out black on
   * nothing, which is invisible on a dark page. On one, it is inverted instead -- hue turned back round
   * so the field colours stay roughly what they were.
   */
  _fitDarkSkin(tree, isSignal) {
    const classes = [tree[1].class, 'is-dark-skin']
    if (isSignal) {
      const body = tree.at(-1)
      if (Array.isArray(body) && body[2]?.[0] === 'rect') {
        body[2][1].style = 'stroke:none;fill:none'
      }
    } else if (this._darkMode.isDark) {
      classes.push('is-inverted')
    }
    tree[1].class = classes.filter(Boolean).join(' ')
  }

  updated(changed) {
    // -> A skin switched in the editor's prop panel, after the first drawing
    if (changed.has('skin') && changed.get('skin') !== undefined && this._source) {
      this._draw()
    }
  }

  firstUpdated() {
    /*
      The source is the block's body, taken from the fence markdown left behind. `textContent` is what
      undoes the escaping in the markup, and gives back what the author typed.
    */
    const fence = this.querySelector('pre')
    this._fenced = Boolean(fence)
    this._source = ((fence ?? this).textContent ?? '').trim()
    if (!this._source) {
      this._error =
        'This diagram is empty. Its source goes in the body of the block, inside a fenced code block.'
      return
    }
    this._draw()
  }

  render() {
    if (this._error) {
      // -> The source stays readable under the message, so the author can see what was read
      return html`<div class="error">${this._error}${this._source
        ? html`<pre>${this._source}</pre>`
        : null}</div>`
    }
    return html`
      <div class="diagram ${this.align === 'center' ? 'is-center' : ''}">
        ${unsafeSVG(this._svg)}
        ${this.caption ? html`<div class="caption">${this.caption}</div>` : null}
      </div>
    `
  }
}

window.customElements.define('block-wavedrom', BlockWavedromElement)
