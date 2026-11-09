import { useI18n } from 'vue-i18n'
import { Position, Range } from 'monaco-editor'

import { dialog } from '@/composables/dialog'
import { notify } from '@/composables/notify'
import { diagramFence, diagramFenceAt } from '@/helpers/diagramFences'

import EditorDiagramOverlay from '@/components/EditorDiagramOverlay.vue'

/**
 * The Markdown editor's Insert Diagram action: a draw.io diagram, in a `diagram` fence the way Wiki.js
 * 2.x wrote them -- the SVG draw.io exports, which carries the drawing it can be re-opened from, as
 * base64 (see `helpers/diagramFences`). The drawing itself happens in `EditorDiagramOverlay`.
 *
 * With the caret inside such a fence `insertDiagram` edits it and the whole fence, opener to closer,
 * is replaced; anywhere else it draws a new one and the fence is inserted at the caret, on lines of
 * its own.
 *
 * Call it during `setup`, for the i18n; `insertDiagram` itself needs the editor to exist.
 *
 * @param {object} opts
 * @param {() => object} opts.getEditor The Monaco editor, once there is one.
 */
export function useDiagramFenceEditing({ getEditor }) {
  const { t } = useI18n()

  function insertDiagram() {
    const editor = getEditor()
    const model = editor.getModel()
    const cursor = editor.getPosition()
    const existing = diagramFenceAt(model.getLinesContent(), cursor.lineNumber)
    if (existing && existing.svg === null) {
      notify({ type: 'negative', message: t('editor.diagram.invalid') })
      return
    }
    dialog({
      component: EditorDiagramOverlay,
      componentProps: { svg: existing?.svg ?? '' }
    }).onOk((svg) => {
      const fence = diagramFence(svg)
      if (existing) {
        // -> Looked up again: the dialog was open for as long as the author was drawing, and the page
        //    may have been edited by somebody else in the meantime, or the fence moved
        const now = diagramFenceAt(
          model.getLinesContent(),
          Math.min(existing.startLine, model.getLineCount())
        )
        if (!now || now.svg !== existing.svg) {
          // -> Not the fence that was opened: replacing by its old lines would overwrite whatever is
          //    there now, so nothing is written and the author is told
          notify({ type: 'negative', message: t('editor.diagram.moved') })
          return
        }
        const target = now
        editor.executeEdits('diagram', [
          {
            range: new Range(
              target.startLine,
              1,
              target.endLine,
              model.getLineMaxColumn(target.endLine)
            ),
            text: fence,
            forceMoveMarkers: true
          }
        ])
        editor.setPosition(new Position(target.startLine, 1))
      } else {
        const position = editor.getPosition() ?? cursor
        const before =
          model
            .getLineContent(position.lineNumber)
            .slice(0, position.column - 1)
            .trim().length > 0
            ? '\n\n'
            : ''
        editor.executeEdits('diagram', [
          {
            range: new Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column
            ),
            text: `${before}${fence}\n\n`,
            forceMoveMarkers: true
          }
        ])
      }
      editor.focus()
    })
  }

  return { insertDiagram }
}
