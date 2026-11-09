# Annotated image block

`block-annotated-image` draws annotations over a picture that is already on the wiki: boxes and
rings around parts, leader lines and arrows, orientation markers, short labels on the picture itself,
and a legend panel beside or below it whose entries are ordinary markdown — so a legend entry can hold
a part number in bold, a link to a datasheet, or inline code. The picture is never modified: the
annotations are vector shapes laid over it, scale with it, print with it, and are edited as text.

It replaces the workflow in which an annotated copy of every photo is produced with Pillow and
uploaded beside the original (see `annotating-board-photos.md` in the evaluation repo): the same
conventions — one colour per thing, labels on a dark panel rather than on the board, two-pass strokes
that read on any background, triangle markers for orientation features — are what the block draws,
from a description a few lines long.

## 1. Shape of the block

The block is an MDC container holding three things, in this order:

```md
::block-annotated-image{panel="right"}
![RBARF v0.2, top side](/projects/rbarf-front.png)

```annotations
space 1600x1200
1 box 420,300 560,420
2 pin 610,130 label="H"
2 pin 640,130 label="L"
3 arrow 900,700 760,520
  tri 1180,88 down
  text 1180,60 "▼ tab side" size=28
```

1. **U2** — MCU, STM32G0B1, LQFP-48
2. CAN **H** / **L** on the RJ45
3. Level shifter **Q1** ([datasheet](https://example.com/bss138.pdf))
::
```

- **The picture** is the first `img` in the block's body, written as markdown or as HTML. Its `src` has
  been through the page renderer, so a wiki path resolves to `/_files/…` exactly as it would in a
  paragraph; `alt` is what the overlay is described as to assistive technology.
- **The annotations** are the first fenced code block in the body, language `annotations` (§2). The
  fence is what keeps markdown's hands off the text; the renderer leaves it as source
  (`<pre class="codeblock-annotations">`) the way it does a mermaid fence, and the block reads it back.
- **The legend** is the first list in the body, ordered or not. Each item is one legend entry, kept as
  the HTML the renderer produced for it, so everything inline markdown allows is allowed in it.
  Optional: a block with no list has no panel.

Why the picture is inside the block rather than the paragraph before it: a block is the one element
in a page whose children it owns. The sanitizer is flat — `img`, `pre`, `ol` and `li` are allowed
wherever they sit — and the renderer already resolves image paths inside a container, so no new
syntax and no new allowance is needed. A block that reached for its previous sibling would instead
depend on whatever the renderer, the editor's preview or a later block happened to put there.
`block-gallery` collects `![](…)` images from its own body for the same reason.

The block renders in its shadow root: its own copy of the image, an SVG overlay sized to it, the
legend panel, an optional caption. The light DOM children are not slotted; before the component is
defined (and for a reader with no JavaScript), the page shows the picture, the source as a dashed
"not yet drawn" panel, and the list — all of it readable.

## 2. The `annotations` language

One instruction per line. Blank lines, and lines starting with `#` or `//`, are ignored. Tokens are
separated by whitespace; a quoted string (`"…"` or `'…'`, with `\"` for a quote inside) is one token.

```
line      := [id] shape positional… option…
          |  "space" SIZE
id        := digits | one letter          -- `1`, `12`, `A`
point     := NUMBER "," NUMBER            -- `420,300`, or `12%,40%` of the space
SIZE      := NUMBER "x" NUMBER            -- `1600x1200`
option    := key "=" value | flag | colour-word
```

### Coordinate space

Coordinates are in **image pixels** — the picture's natural size — unless the fence declares a
`space WxH`, in which case they are in that space, stretched onto the picture. This is how a
photograph that was measured on a 900 px preview is annotated without converting anything: declare
`space 900x600` and write the preview coordinates. A percentage (`12%,40%`) is of the space's width
and height respectively, whatever the space is.

### Shapes

| Shape | Positional | Draws |
| -- | -- | -- |
| `box P1 P2` | two opposite corners | rounded rectangle outline |
| `circle P [r]` | centre, radius (image units, or `r%` of width) | ring; without `r`, the default pin radius |
| `pin P` | centre | same as `circle P` with the default radius — marks one connector contact |
| `line P P…` | two or more points | open polyline |
| `arrow P P…` | two or more points | polyline with an arrowhead at the **last** point |
| `poly P P P…` | three or more points | closed polygon outline |
| `tri P dir` | position, `up`/`down`/`left`/`right` | small filled triangle pointing that way — an orientation marker |
| `text P "string"` | position, the text | text on the picture, with a dark halo so it reads on copper |

### Options

| Option | On | Meaning |
| -- | -- | -- |
| `color=…` or a bare colour word | any | a palette name (below) or any CSS colour |
| `dashed` | outlines and lines | dashed stroke — "an alternative placement" |
| `width=N` | outlines and lines | stroke width, in image units; default scales with the space (§3) |
| `r=N` | `box` | corner radius |
| `size=N` | `text`, `label` | font size, image units |
| `anchor=start\|middle\|end` | `text` | horizontal anchor; default `middle` |
| `bold` | `text` | bold face |
| `label="…"` | any but `text` | short text drawn next to the shape's anchor, in its colour, with a halo |
| `at=P` | any | where the id disc (and `label`) sits, overriding the anchor below |

### Ids, discs and the legend

A line that starts with an id belongs to that id. The **first** shape of an id gets a filled disc at
its anchor carrying the id, and every shape of the id lights up together: hovering (or focusing, or
tapping) a legend entry dims every other id's shapes; hovering a shape highlights its legend entry.
Several shapes may share an id — a box and the leader pointing at it, or the two pins of a pair.

An id is tied to a legend entry: when every id in the fence is a number, id *n* is the *n*-th entry;
otherwise ids are tied to entries in the order the ids first appear. An entry with no id of its own
is shown without a disc; a disc with no entry is drawn and tied to nothing.

Default **anchors** (where the disc goes): `box` its top-left corner; `circle`/`pin` the point at
45° up and to the right of the ring; `line`/`arrow`/`poly` the first point; `tri` the side away from
where it points. `text` has no disc even with an id: its text is its own label.

### Colours

Named colours, chosen to read against green soldermask and bare copper alike:

| name | value | | name | value |
| -- | -- | -- | -- | -- |
| `blue` | `#5096ff` | | `purple` | `#b57bff` |
| `red` | `#ff5050` | | `cyan` | `#40d8e8` |
| `orange` | `#ff9628` | | `pink` | `#ff78c8` |
| `yellow` | `#ffd23c` | | `white` | `#ebebeb` |
| `green` | `#50e678` | | `black` | `#141414` |

A shape with an id and no colour takes the palette in id order — blue, red, orange, yellow, green,
purple, cyan, pink, and round again — so that a fence with no colour in it at all is already one colour
per thing. A shape with no id and no colour is `white`.

## 3. Drawing

- The overlay is an `<svg>` with `viewBox="0 0 W H"` (the space, or the natural size) laid over the
  image box with `preserveAspectRatio="none"`, so it stretches exactly as the picture does, whatever
  width the column gives it, and a photo measured on a preview lines up.
- **Every default size is relative to the space width W**, so a 4000 px photo and an 800 px screenshot
  come out alike: stroke `W/250`, halo twice that, label text `W/45`, pin radius `W/70`, triangle
  `W/60`. The block's `scale` prop multiplies all of them.
- **A disc is sized by its id**, so a single digit fills it the way it fills a badge: radius `W/80` for
  a one-character id, `W/60` for two, `W/40` for three or more; the id is drawn bold at `W/60` in
  every case. A `label` beside a disc starts past that disc's own radius. The legend panel's discs are
  CSS and are not affected.
- **Two passes per stroke** — a wide dark stroke under the coloured one — and `paint-order: stroke`
  with a dark halo on every text, so an annotation reads on a light render, a dark photo, copper or
  silkscreen. The disc is a filled circle in the shape's colour with its id in near-black.
- `dashed` is a dash array in multiples of the stroke width, so the dashes scale with it.
- Shapes take pointer events; the SVG itself does not, so a reader can still right-click and save the
  picture. With `interactive="false"` the shapes do not either: no shape or legend entry listens for
  the pointer, focus or a tap, entries take no `tabindex`, and nothing is ever dimmed or highlighted.
- The legend panel is **dark whatever the site theme** — `#121620`, text `#ebebeb` — like the panel the
  Pillow workflow extended the canvas with: the palette is chosen against dark, and yellow on white is
  not a label. Each entry carries the disc of its id and the entry's own HTML; the active entry gets a
  rule in its colour down its left edge and a lighter background.
- `panel="right"` / `"left"` puts the panel beside the picture (`minmax(220px, 30%)`), falling below
  it when the block is narrower than about 640 px (a container query); `"below"` (the default) and
  `"above"` stack; `"none"` draws no panel, list or not.
- The caption, when given, sits under everything, styled as other blocks style theirs.
- **The figure's width** — the picture and a legend beside it, together — is the `width` prop when
  it is given, otherwise the `width` attribute the renderer wrote on the image from markdown-it-imsize's
  `=WxH` (`![alt](x.png =10%x10%)` arrives as `width="10%"`), otherwise the column. `60%` is a share
  of the column and a bare number is pixels; an unparseable value is ignored. The image's `height` is
  ignored: the aspect ratio is the picture's. What the width sizes depends on where the legend is:
  - beside it (`right` / `left`), the **picture's column** only: the figure stays the width of the
    column and the grid becomes `minmax(0, W) minmax(220px, 1fr)` (mirrored for `left`), so the legend
    takes the rest of the row beside a smaller picture. The 640 px container query measures the
    column, and below it the two stack as usual;
  - stacked (`below` / `above` / `none`, or a block with no list), the **whole figure**, as `width`
    with `max-width: 100%` and `min-width: min(100%, 240px)`, so a very small percentage still leaves a
    legend that can be read under the picture.

  With no width given, a stacked figure is capped at the picture's natural width so a small screenshot
  is not blown up; with one, there is no cap. `align="center"` centres a narrower figure.
- The image is this block's own `<img>` in its shadow root, `width: 100%; height: auto` of the
  picture box, so nothing about the figure depends on the stylesheet of the page around it. The overlay is drawn only once the
  image has loaded and its natural size is known; an image that fails to load shows its `alt` in a
  dashed box and the parse errors, if any.
- **Errors never blank the figure.** A line that does not parse is skipped and reported — line number
  and reason — in a small list under the picture, in the style `block-wavedrom` reports its errors.
  Everything that did parse is drawn.
- Dark mode goes through `blocks/shared/theme.js` (`DarkMode`), for the caption and the error list; the
  panel and the overlay do not change with it.

## 4. Props

| Prop | Type | Default | |
| -- | -- | -- | -- |
| `panel` | select `below` `right` `left` `above` `none` | `below` | where the legend goes |
| `scale` | number | `1` | multiplies every default size of §3 |
| `width` | string | | the figure's width: `60%` of the column, or `480` pixels; empty follows the image's own `width`, or the column |
| `interactive` | boolean | `true` | whether pointing at a legend entry or a shape highlights the pair; `"false"` is read as off |
| `caption` | string | | shown under the figure |
| `align` | select `left` `center` | `left` | as every other figure block |

The picker's `template` is the body of §1 with placeholder values; an `asciidocTemplate` spells the
same body in AsciiDoc (`image::…[]`, a `[source,annotations]` listing, a `.` list). No
`contentEditor` for now — the body is edited in the page, with the editor's preview drawing it live —
and §6 says what a visual editor would be built on.

## 5. What else changes

- `frontend/src/renderers/shared.js`: `annotations` joins the languages left as source
  (`DIAGRAM_LANGUAGES`), so the fence reaches the page as `<pre class="codeblock-annotations">` and
  is not run through highlight.js. `helpers/markdownFences.js` reads the same list and is unaffected.
- `frontend/src/css/_page-contents.scss`: `pre.codeblock-annotations` joins the dashed "not drawn"
  panel with the diagram sources.
- Nothing on the server: a new built-in block is registered from the manifest at boot and enabled by
  default, and its tag and prop attributes enter the sanitizer's allow list from the same definition.

## 6. Later

- **A visual editor** as `contentEditor: 'annotations'` through `BlockContentEditorOverlay`: click to
  place a pin, drag a box, type a label, with the fence written back. `findBlockContent` currently
  hands a body editor only the single fence of a block that holds nothing else, so it would have to
  learn to pass the whole body, or the editor would have to find the image on its own.
- `brace P1 P2 side` for pinouts spanning several contacts.
- A `zoom` that opens the figure full size in a lightbox, the way `block-gallery` does.
