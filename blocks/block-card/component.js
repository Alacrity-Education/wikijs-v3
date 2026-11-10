import { LitElement, html, css } from 'lit'
import { DarkMode } from '../shared/theme.js'

/** How wide the picture is drawn, by the `pictureSize` a card names. */
const PICTURE_SIZES = { small: '64px', medium: '96px', large: '128px' }

/**
 * Whether a light DOM child is the card's picture: one image and no text of its own.
 *
 * That is `![…](…)` on a line by itself in markdown, which arrives as a paragraph holding the image
 * (or a link holding it), and `image::…[]` in AsciiDoc, which arrives as two `div`s around it. Asked of
 * what is there rather than of a tag name, so both shapes and a bare `<img>` read the same.
 */
function isPicture(el) {
  if (el.localName === 'img') {
    return true
  }
  return el.querySelectorAll('img').length === 1 && !el.textContent.trim()
}

/**
 * Block Card
 *
 * One card of a `block-cards` row: a title across the top, a picture on the left with text beside it,
 * and optionally more text across the card below them. Drawn as an outlined surface with small
 * corners.
 *
 * Every part of it is the author's own markdown, written in order in the body:
 *
 *     ::block-card
 *     ## Airbox            <- a heading first: the title, drawn at h2 size whatever its level
 *     ![Airbox](airbox.jpg) <- the first image on a line of its own: the picture
 *     A line or two.       <- everything else: the text beside the picture
 *     ---                  <- optional: whatever comes after the first rule goes below
 *     The longer story.
 *     ::
 *
 * So the content stays in the light DOM, where the article's stylesheet draws it as it draws the rest of
 * the page -- links, lists and code in a card look like links, lists and code anywhere -- and this
 * element only sorts the children into named slots of its shadow root, which draws the card around
 * them. Their spacing inside the card is in `frontend/src/css/_page-contents.scss`, since a document's
 * own rules outrank a shadow root's `::slotted()` ones.
 *
 * The title is a real heading, so it reads as one to a screen reader and in search, but it is not a
 * section of the page: the table of contents leaves out headings inside a card (`anchorHeadings`,
 * both the server's and `helpers/toc.js`).
 */
export class BlockCardElement extends LitElement {
  /**
   * Metadata for the admin area and the editor's block picker. Collected at build time into
   * `compiled/blocks.manifest.json`, which the server reads to register the block. Values must be
   * plain literals. See `props` in `block-index` for what the picker does with that list.
   *
   * `isChild`: a card is part of the row it sits in, inserted with it and switched on and off with it.
   */
  static definition = {
    block: 'card',
    name: 'Card',
    description: 'One card of a row of cards.',
    icon: 'resume-template',
    isChild: true,
    props: [
      {
        name: 'pictureSize',
        type: 'select',
        label: 'Picture Size',
        hint: 'How wide the picture on the left is drawn.',
        default: 'medium',
        options: [
          { label: 'Small', value: 'small' },
          { label: 'Medium', value: 'medium' },
          { label: 'Large', value: 'large' }
        ]
      }
    ]
  }

  static get properties() {
    return {
      /**
       * small, medium or large
       * @type {string}
       */
      pictureSize: { type: String },
      _parts: { state: true }
    }
  }

  static get styles() {
    return css`
      :host {
        --card-border: #d6d9de;
        --card-bg: #fff;
        display: block;
        min-width: 0;
      }
      :host([dark]) {
        --card-border: rgba(255, 255, 255, 0.15);
        --card-bg: #1e232a;
      }

      /* -> The height of the tallest card on the line, which the grid has given the host */
      .card {
        box-sizing: border-box;
        height: 100%;
        padding: 16px;
        border: 1px solid var(--card-border);
        border-radius: 6px;
        background-color: var(--card-bg);
      }

      .title {
        margin-bottom: 12px;
      }

      /*
        Picture and text side by side, always: the picture is as wide as pictureSize says, but never more
        than a third of the card, so four cards to a line still leave the text room beside it.
      */
      .main {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .picture {
        flex: none;
        width: min(var(--card-picture-size, 96px), 35%);
      }
      .text {
        flex: 1 1 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .below {
        margin-top: 12px;
      }

      [hidden] {
        display: none !important;
      }
    `
  }

  constructor() {
    super()
    this.pictureSize = 'medium'
    this._parts = { title: false, picture: false, text: false, below: false }
    this._darkMode = new DarkMode(this)
    this._observer = new MutationObserver(() => this._sort())
  }

  connectedCallback() {
    super.connectedCallback()
    this._sort()
    this._observer.observe(this, { childList: true })
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this._observer.disconnect()
  }

  willUpdate(changed) {
    if (changed.has('pictureSize')) {
      this.style.setProperty(
        '--card-picture-size',
        PICTURE_SIZES[this.pictureSize] ?? PICTURE_SIZES.medium
      )
    }
  }

  /**
   * Give a picture written straight above its text a paragraph of its own.
   *
   * `![…](…)` with the text on the very next line is one paragraph in markdown -- the image and the
   * words run together -- and that is the natural way to write a card. So a paragraph that STARTS with
   * an image (or a link holding one), before the title's rule and with no picture yet, has that image
   * moved out into a paragraph of its own in front of it, along with the line break after it. The one
   * place this element changes its children rather than labelling them; done before anything is
   * sorted, and a no-op the second time, since the paragraph no longer starts with an image.
   */
  _splitPicture() {
    for (const el of this.children) {
      if (el.localName === 'hr' || isPicture(el)) {
        return
      }
      if (el.localName !== 'p') {
        continue
      }
      const first = [...el.childNodes].find(
        (node) => node.nodeType !== Node.TEXT_NODE || node.textContent.trim()
      )
      const holdsImage =
        first?.localName === 'img' ||
        (first?.localName === 'a' &&
          first.querySelectorAll('img').length === 1 &&
          !first.textContent.trim())
      if (!holdsImage) {
        return
      }
      const picture = document.createElement('p')
      picture.append(first)
      // -> The break that ended the image's line, and the whitespace either side of it
      while (
        el.firstChild &&
        (el.firstChild.localName === 'br' ||
          (el.firstChild.nodeType === Node.TEXT_NODE && !el.firstChild.textContent.trim()))
      ) {
        el.firstChild.remove()
      }
      el.before(picture)
      return
    }
  }

  /**
   * Put each child in the slot its place in the body gives it -- see the class comment -- and mark the
   * first and last of each part, which is what the page stylesheet takes the outer margins off.
   *
   * The rule itself goes to a slot that is never rendered: it is a separator in the source, not
   * something to draw. Only attributes change here, never the order or the nodes themselves, so the
   * render stays exactly what the editor and the server produced.
   */
  _sort() {
    this._splitPicture()
    const groups = { title: [], picture: [], text: [], below: [] }
    let broken = false
    for (const [index, el] of [...this.children].entries()) {
      let part
      if (broken) {
        part = 'below'
      } else if (el.localName === 'hr') {
        broken = true
        part = 'break'
      } else if (index === 0 && /^h[1-6]$/.test(el.localName)) {
        part = 'title'
      } else if (groups.picture.length < 1 && isPicture(el)) {
        part = 'picture'
      } else {
        part = 'text'
      }
      // -> The text is the default slot: no attribute, so nothing that reads the content sees a change
      const slot = part === 'text' ? null : part
      if (el.getAttribute('slot') !== slot) {
        if (slot === null) {
          el.removeAttribute('slot')
        } else {
          el.setAttribute('slot', slot)
        }
      }
      el.removeAttribute('data-card-first')
      el.removeAttribute('data-card-last')
      groups[part]?.push(el)
    }
    for (const group of Object.values(groups)) {
      group[0]?.setAttribute('data-card-first', '')
      group.at(-1)?.setAttribute('data-card-last', '')
    }
    this._parts = {
      title: groups.title.length > 0,
      picture: groups.picture.length > 0,
      text: groups.text.length > 0,
      below: groups.below.length > 0
    }
  }

  render() {
    const { title, picture, text, below } = this._parts
    return html`
      <div class="card">
        <div class="title" ?hidden=${!title}><slot name="title"></slot></div>
        <div class="main" ?hidden=${!picture && !text}>
          <div class="picture" ?hidden=${!picture}><slot name="picture"></slot></div>
          <div class="text" ?hidden=${!text}><slot></slot></div>
        </div>
        <div class="below" ?hidden=${!below}><slot name="below"></slot></div>
      </div>
    `
  }
}

window.customElements.define('block-card', BlockCardElement)
