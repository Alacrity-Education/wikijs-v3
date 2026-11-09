import { onBeforeUnmount } from 'vue'

/**
 * The `svg` format of `BlockContentDrawio`, beside its own `xml` one: the model is a complete SVG
 * that embeds the drawing in its root `content` attribute -- draw.io's `xmlsvg` export, which is what
 * Wiki.js 2.x stored, base64 encoded, in a `diagram` fence -- rather than draw.io's XML document. It
 * is what `EditorDiagramOverlay` edits.
 *
 * The two formats differ in how the drawing is taken out of draw.io. The `xml` format loads with
 * `autosave` on, so every `autosave` / `save` event updates the model and a host with its own Apply
 * button always has the drawing as it stands. This one loads with `autosave` off and `saveAndExit`
 * on, because producing the SVG is an asynchronous round trip and only a deliberate Save is worth one:
 *
 *   in   `{ event: 'save' }`      -> out `{ action: 'export', format: 'xmlsvg' }`
 *   in   `{ event: 'export', data: 'data:image/svg+xml;base64,…' }`
 *        -> `update:modelValue` with the decoded SVG text, then `save`
 *   in   `{ event: 'exit' }`      -> `exit` (Save exits too; so does closing it)
 *
 * draw.io's own Save and Exit are shown (`urlParams`): the host of an svg drawing has no Apply button,
 * and they are the whole of the way out. Call it during `setup`: its timer is cleared with the
 * component. Nothing here runs while the format is `xml`.
 *
 * @param {object} opts
 * @param {() => boolean} opts.isEnabled Whether the component is in the svg format, read when asked.
 * @param {(message: object) => void} opts.post Sends a message to the frame.
 * @param {(event: string, ...args: unknown[]) => void} opts.emit The component's `emit`.
 */
export function useDrawioSvgFormat({ isEnabled, post, emit }) {
  // -> `save` has asked for an export that has not come back, and an `exit` that arrives in that window
  //    is held until it has, or the host would close on a drawing it never received
  let exportPending = false
  let exitAfterExport = false
  /*
    How long an export may take before it is given up on. draw.io answers one in well under a second;
    without a limit, an `exit` held for an export that never comes would hold the author in a drawing
    they have already left, with the overlay's own Close as the only way out.
  */
  const EXPORT_TIMEOUT = 15000
  let exportTimer = null

  /** The frame's query parameters this format sets differently from the xml one; none for xml. */
  function urlParams() {
    return isEnabled() ? { noExitBtn: '0', saveAndExit: '1' } : {}
  }

  /**
   * What the `load` action says differently from the xml format; none for xml. draw.io's `xml` field
   * accepts a complete SVG that embeds the model as well as mxfile XML; empty is a new drawing.
   */
  function loadOptions() {
    return isEnabled() ? { autosave: 0, saveAndExit: 1 } : {}
  }

  /** The text of a `data:…;base64,` URI, decoded as UTF-8 (`atob` alone gives one character per byte). */
  function decodeDataUri(uri) {
    const base64 = String(uri ?? '').replace(/^data:[^,]*,/, '')
    return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)))
  }

  /**
   * One message from the frame, when it is this format's to answer: `save`, `export` and `exit`.
   *
   * @returns {boolean} Whether it was taken. False leaves it to the component, as in the xml format.
   */
  function onMessage(message) {
    if (!isEnabled()) {
      return false
    }
    switch (message.event) {
      case 'save':
        // -> The model arrives as `export`; the XML this event carries is not what is stored
        exportPending = true
        clearTimeout(exportTimer)
        exportTimer = setTimeout(() => {
          exportPending = false
          if (exitAfterExport) {
            exitAfterExport = false
            emit('exit')
          }
        }, EXPORT_TIMEOUT)
        post({ action: 'export', format: 'xmlsvg', spin: 'Saving' })
        return true
      case 'export':
        // -> draw.io answers an `xmlsvg` export as `format: 'svg'` (the request it echoes under `message`
        //    is what still says `xmlsvg`), so either spelling is the answer being waited for
        if (message.format === 'svg' || message.format === 'xmlsvg') {
          exportPending = false
          clearTimeout(exportTimer)
          try {
            emit('update:modelValue', decodeDataUri(message.data))
            emit('save')
          } catch {
            // -> Not a base64 data URI: nothing usable came back, so neither the model nor `save`
            //    change -- and an exit held for this export is dropped too, since leaving now would
            //    lose the drawing without a word
            exitAfterExport = false
          }
          if (exitAfterExport) {
            exitAfterExport = false
            emit('exit')
          }
        }
        return true
      case 'exit':
        if (exportPending) {
          exitAfterExport = true
        } else {
          emit('exit')
        }
        return true
    }
    return false
  }

  onBeforeUnmount(() => {
    clearTimeout(exportTimer)
  })

  return { urlParams, loadOptions, onMessage }
}
