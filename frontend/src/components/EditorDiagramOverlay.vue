<template>
  <w-dialog
    v-model="dialogVisible"
    class="main-overlay"
    persistent
    full-width
    full-height
    @hide="onDialogHide">
    <w-layout class="editor-diagram" view="hHh lpR fFf" container>
      <w-header class="card-header px-4 py-2">
        <w-icon name="mdi:shape-plus-outline" left size="md" />
        <span>{{ t('editor.diagram.title') }}</span>
        <w-space />
        <w-btn
          push
          color="white"
          text-color="grey-7"
          :label="t(`common.actions.close`)"
          :aria-label="t(`common.actions.close`)"
          icon="la:times"
          @click="onDialogCancel" />
      </w-header>
      <w-page-container>
        <w-page class="editor-diagram-body">
          <block-content-drawio
            v-model="state.svg"
            format="svg"
            @save="onSave"
            @exit="onDialogCancel" />
        </w-page>
      </w-page-container>
    </w-layout>
  </w-dialog>
</template>

<script setup>
import { reactive } from 'vue'
import { useI18n } from 'vue-i18n'

import { dialogComponentEmits, useDialogComponent } from '@/composables/dialog'

import BlockContentDrawio from '@/components/BlockContentDrawio.vue'

/**
 * A draw.io diagram in a full-screen dialog, for the Markdown editor's `diagram` fences.
 *
 * Opened with `dialog({ component: EditorDiagramOverlay, componentProps: { svg } })`, where `svg` is
 * the drawing as draw.io's `xmlsvg` export (empty for a new one). `onOk` receives the new SVG text
 * when the author saves; closing the dialog, or leaving draw.io without saving, resolves nothing
 * (`onCancel`). There is deliberately no Apply button: draw.io's own Save is the only way to produce
 * the SVG, and see `BlockContentDrawio` for the protocol.
 */

// PROPS

const props = defineProps({
  /** The drawing to edit, as a complete SVG that embeds its model; empty for a new drawing. */
  svg: {
    type: String,
    default: ''
  }
})

// EMITS

defineEmits([...dialogComponentEmits])

// DIALOG

const { dialogVisible, onDialogHide, onDialogOK, onDialogCancel } = useDialogComponent()

// I18N

const { t } = useI18n()

// DATA

const state = reactive({
  svg: props.svg
})

// METHODS

function onSave() {
  onDialogOK(state.svg)
}
</script>

<style lang="scss">
.editor-diagram {
  @at-root .body--light & {
    color: var(--color-black);
  }
  @at-root .body--dark & {
    color: var(--color-white);
  }

  /* -> The editor fills the dialog; see `.block-content-editor-body` for why `min-height: 0` */
  &-body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 0;

    > * {
      flex: 1 1 auto;
      min-height: 0;
    }
  }
}
</style>
