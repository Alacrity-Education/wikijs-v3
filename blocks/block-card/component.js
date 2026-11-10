import { LitElement, html, css } from 'lit'
import { DarkMode } from '../shared/theme.js'

/** The gap between two pictures in a card's row of them, in pixels. */
const PICTURE_GAP = 8

/**
 * Whether a light DOM child is pictures and nothing else: one image or more, and no text of its own.
 *
 * That is `![…](…)` on a line by itself in markdown -- or several of them on one line -- which arrives
 * as a paragraph holding the images (or links holding them), and `image::…[]` in AsciiDoc, which
 * arrives as two `div`s around one. Asked of what is there rather than of a tag name, so every shape
 * and a bare `<img>` read the same.
 */
function isPicture(el) {
  if (el.localName === 'img') {
    return true
  }
  return el.querySelectorAll('img').length > 0 && !el.textContent.trim()
}

/** Whether a node inside a paragraph is one of its pictures: an image, or a link holding only one. */
function isImageNode(node) {
  return (
    node.localName === 'img' ||
    (node.localName === 'a' &&
      node.querySelectorAll('img').length === 1 &&
      !node.textContent.trim())
  )
}

/** Whether a node inside a paragraph is only the space between two pictures. */
function isSpacer(node) {
  return node.localName === 'br' || (node.nodeType === Node.TEXT_NODE && !node.textContent.trim())
}

/**
 * Block Card
 *
 * One card of a `block-cards` row: a title across the top, a picture the full width of the card under
 * it -- or several, side by side, sharing that width -- and text below the pictures. Drawn as an outlined surface with small corners.
 *
 * Every part of it is the author's own markdown, written in order in the body:
 *
 *     ::block-card
 *     ## Airbox            <- a heading first: the title, drawn at h2 size whatever its level
 *     ![Airbox](airbox.jpg) <- images before any text: the pictures, in a row ![b](b.jpg) ![c](c.jpg)
 *     What it is.          <- everything else: the text below the picture
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
    isChild: true
  }

  static get properties() {
    return {
      _parts: { state: true }
    }
  }

  static get styles() {
    return css`
      /*
        The card is three rows of the row of cards it sits in -- title, pictures, text -- shared with
        every other card on that line through a subgrid. So each band is as tall as the tallest of its
        kind on the line: the titles line up, the text of every card starts at the same height, and a
        picture shorter than its band is centred in it.

        Hence the box is drawn on the host rather than on an element inside it: the three parts have
        to be the host's own grid items for the subgrid to reach them. A browser without subgrid sizes
        the three rows to this card alone, which is the card as it was before.
      */
      :host {
        --card-border: #d6d9de;
        --card-bg: #fff;
        display: grid;
        grid-row: span 3;
        grid-template-rows: subgrid;
        row-gap: 12px;
        min-width: 0;
        /*
          Important, because the host is an element of the page as well: the page's reset (Tailwind's
          preflight) takes the border and padding off every element, and a document's own rules
          outrank a shadow root's :host ones -- except against !important, where the shadow root wins.
        */
        box-sizing: border-box !important;
        padding: 16px !important;
        border: 1px solid var(--card-border) !important;
        border-radius: 6px !important;
        background-color: var(--card-bg) !important;
      }
      :host([dark]) {
        --card-border: rgba(255, 255, 255, 0.15);
        --card-bg: #1e232a;
      }

      /* -> Placed by row, so a card missing a part leaves that band empty rather than moving up */
      .title {
        grid-row: 1;
      }

      /*
        The whole width of the card, inside its padding, shared equally between the pictures when there
        are several: each slotted paragraph of them is a share. The images are sized to their share by
        the page CSS, and several in ONE paragraph are spread across it by _layoutPictures. Stretched to
        the band's height, with the pictures centred in it.
      */
      .picture {
        grid-row: 2;
        display: flex;
        align-items: center;
        gap: ${PICTURE_GAP}px;
      }
      ::slotted(*) {
        flex: 1 1 0;
        min-width: 0;
      }

      .text {
        grid-row: 3;
        overflow-wrap: anywhere;
      }

      [hidden] {
        display: none !important;
      }
    `
  }

  constructor() {
    super()
    this._parts = { title: false, picture: false, text: false }
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

  /**
   * Give the pictures written straight above their text a paragraph of their own.
   *
   * `![…](…)` with the text on the very next line is one paragraph in markdown -- the images and the
   * words run together -- and that is the natural way to write a card. So a paragraph that STARTS with
   * images (or links holding one each), with no picture before it, has those images moved out into a
   * paragraph of their own in front of it, along with the line breaks between and after them. The one
   * place this element moves its children rather than labelling them; done before anything is sorted,
   * and a no-op the second time, since the paragraph no longer starts with an image.
   */
  _splitPicture() {
    for (const el of this.children) {
      if (isPicture(el)) {
        return
      }
      if (el.localName !== 'p') {
        continue
      }
      const leading = []
      for (const node of el.childNodes) {
        if (isImageNode(node)) {
          leading.push(node)
        } else if (!isSpacer(node)) {
          break
        }
      }
      if (leading.length < 1) {
        return
      }
      const picture = document.createElement('p')
      picture.append(...leading)
      while (el.firstChild && isSpacer(el.firstChild)) {
        el.firstChild.remove()
      }
      el.before(picture)
      return
    }
  }

  /**
   * Spread several pictures in one paragraph across it, equal shares side by side, as the card does
   * with several paragraphs of them. Inline, because these are the paragraph's own children, which no
   * rule in the shadow root can reach; the line breaks between them go, having nothing to break.
   */
  _layoutPictures(el) {
    if (el.localName !== 'p') {
      return
    }
    Object.assign(el.style, {
      display: 'flex',
      alignItems: 'center',
      gap: `${PICTURE_GAP}px`
    })
    for (const child of el.children) {
      if (child.localName === 'br') {
        child.style.display = 'none'
      } else {
        Object.assign(child.style, { flex: '1 1 0', minWidth: '0', display: 'block' })
      }
    }
  }

  /**
   * Put each child in the slot its place in the body gives it -- see the class comment -- and mark the
   * first and last of each part, which is what the page stylesheet takes the outer margins off. Only
   * attributes change here, never the order or the nodes themselves.
   */
  _sort() {
    this._splitPicture()
    const groups = { title: [], picture: [], text: [] }
    for (const [index, el] of [...this.children].entries()) {
      let part
      if (index === 0 && /^h[1-6]$/.test(el.localName)) {
        part = 'title'
      } else if (groups.text.length < 1 && isPicture(el)) {
        part = 'picture'
        this._layoutPictures(el)
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
      groups[part].push(el)
    }
    for (const group of Object.values(groups)) {
      group[0]?.setAttribute('data-card-first', '')
      group.at(-1)?.setAttribute('data-card-last', '')
    }
    this._parts = {
      title: groups.title.length > 0,
      picture: groups.picture.length > 0,
      text: groups.text.length > 0
    }
  }

  render() {
    const { title, picture, text } = this._parts
    return html`
      <div class="title" ?hidden=${!title}><slot name="title"></slot></div>
      <div class="picture" ?hidden=${!picture}><slot name="picture"></slot></div>
      <div class="text" ?hidden=${!text}><slot></slot></div>
    `
  }
}

window.customElements.define('block-card', BlockCardElement)
