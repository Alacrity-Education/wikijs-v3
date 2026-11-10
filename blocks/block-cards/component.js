import { LitElement, html, css } from 'lit'

/**
 * The narrowest a card is allowed to get before the row gives up a column, in pixels: room for a
 * picture and a few words under it. Below that the cards wrap onto the next line instead.
 */
const MIN_CARD_WIDTH = 200

/** The gap between two cards, across and down, in pixels. */
const GAP = 16

/**
 * Block Cards
 *
 * A row of `block-card`s, up to four to a line, wrapping onto the next line as the page narrows.
 *
 * It draws nothing but the grid. The cards are its light DOM children, put through one `<slot>` --
 * which is `display: contents`, so each card is a grid item of this element directly and every card on
 * a line stretches to the tallest one.
 */
export class BlockCardsElement extends LitElement {
  /**
   * Metadata for the admin area and the editor's block picker. Collected at build time into
   * `compiled/blocks.manifest.json`, which the server reads to register the block. Values must be
   * plain literals. See `props` in `block-index` for what the picker does with that list.
   *
   * `template` is the body the picker writes into the page along with the opening line, which also
   * fences this block with `:::` so the `::block-card` children inside it close only themselves.
   */
  static definition = {
    block: 'cards',
    name: 'Cards',
    description:
      'A row of cards, up to four to a line, each with a title, a picture and text below it.',
    icon: 'module',
    template: `::block-card
## First project
![First project](/_assets/logo-wikijs.svg)
What it is, in a few lines under the picture.
::

::block-card
## Second project
![Second project](/_assets/logo-wikijs.svg)
What it is, in a few lines under the picture.
::`,
    /*
      The same two cards in AsciiDoc. A section title cannot sit inside a delimited block, so the
      card's title is a discrete heading.
    */
    asciidocTemplate: `[block-card]
--
[discrete]
== First project

image::/_assets/logo-wikijs.svg[First project]

What it is, in a few lines under the picture.
--

[block-card]
--
[discrete]
== Second project

image::/_assets/logo-wikijs.svg[Second project]

What it is, in a few lines under the picture.
--`,
    props: [
      {
        /*
          The most to a line, as a choice: a free number field could be filled in with twelve. A
          narrower page fits fewer and wraps the rest (`MIN_CARD_WIDTH`).
        */
        name: 'columns',
        type: 'select',
        label: 'Cards per Line',
        hint: 'The most cards side by side. Fewer fit on a narrow screen, and the rest wrap below.',
        default: '3',
        options: [
          { label: '1', value: '1' },
          { label: '2', value: '2' },
          { label: '3', value: '3' },
          { label: '4', value: '4' }
        ]
      }
    ]
  }

  static get properties() {
    return {
      /**
       * The most cards to a line, 1 to 4
       * @type {string}
       */
      columns: { type: String, reflect: true }
    }
  }

  static get styles() {
    return css`
      /*
        Each track is at least MIN_CARD_WIDTH and at least a 1/columns share of the line, so
        auto-fill never makes more than columns of them, and makes fewer once a share would be too
        narrow. Read through a custom property so the column count is the only thing render() sets.
        -> The gap below the block is on the host: there is no element of its own to put it on.
      */
      :host {
        --cards-columns: 3;
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(
            max(
              ${MIN_CARD_WIDTH}px,
              (100% - (var(--cards-columns) - 1) * ${GAP}px) / var(--cards-columns)
            ),
            1fr
          )
        );
        gap: ${GAP}px;
        margin-bottom: 16px;
      }
    `
  }

  constructor() {
    super()
    this.columns = '3'
  }

  updated() {
    const count = Math.min(4, Math.max(1, Number.parseInt(this.columns, 10) || 3))
    this.style.setProperty('--cards-columns', String(count))
  }

  render() {
    return html`<slot></slot>`
  }
}

window.customElements.define('block-cards', BlockCardsElement)
