<template>
  <div class="block-content-drawio">
    <iframe
      ref="frameEl"
      class="block-content-drawio-frame"
      :src="editorUrl"
      :title="t('editor.blockContent.drawioTitle')" />
    <!--
      Covers the frame until draw.io says hello, and stays covering it if it never does. The editor is
      loaded from another host, so "nothing appeared" is a real outcome — an offline wiki, a blocked
      origin, a self-hosted deployment that has moved — and a blank white rectangle explains none of
      that.
    -->
    <div v-if="!state.ready" class="block-content-drawio-veil">
      <template v-if="state.timedOut">
        <w-icon name="la:plug" size="42px" />
        <div class="mt-3 text-body1">{{ t('editor.blockContent.drawioUnreachable') }}</div>
        <div class="text-caption mt-1 opacity-70">{{ origin }}</div>
      </template>
      <template v-else>
        <w-spinner size="42px" color="primary" />
        <div class="mt-3 text-caption">{{ t('editor.blockContent.drawioLoading') }}</div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useDark } from '@/composables/dark'

/**
 * The draw.io drawing surface, as a body editor for `block-drawio`.
 *
 * Everything in this file is draw.io's own: nothing else in the app knows this protocol, and the
 * block system it plugs into knows only that it takes a string of text and gives one back. See
 * `BlockContentEditorOverlay` for what an editor component has to be.
 *
 * draw.io is embedded rather than reimplemented, and it is embedded rather than bundled because it is
 * a whole application. The wiki holds an iframe and talks to it over `postMessage`, which is what the
 * `embed=1&proto=json` mode of any draw.io deployment offers:
 *
 *   in   `{ event: 'init' }`            it is ready to be given a drawing
 *   out  `{ action: 'load', xml, … }`   here is the drawing
 *   in   `{ event: 'autosave', xml }`   the drawing changed
 *   in   `{ event: 'save', xml }`       the author pressed its Save button
 *
 * `autosave` is what keeps this component's model current, so the overlay's own Apply always has the
 * drawing as it stands; `save` is the same thing plus "and close", which is what the author means by
 * pressing it. Nothing is ever uploaded: an embedded draw.io does its work in the browser, and the XML
 * arrives here rather than at whoever is hosting the editor.
 *
 * There are two formats, picked by the `format` prop, and they differ in what `modelValue` holds and
 * in how the drawing is taken out of draw.io:
 *
 *   `xml` (default)  the model is draw.io's own XML document. The drawing is loaded with `autosave`
 *                    on and every `autosave` / `save` event updates the model, so a host with its own
 *                    Apply button always has the drawing as it stands. `save` also emits `save`.
 *   `svg`            the model is a complete SVG that embeds the drawing in its root `content`
 *                    attribute (draw.io's `xmlsvg` export, which is what Wiki.js 2.x stored, base64
 *                    encoded, in a `diagram` fence). It is loaded with `autosave` off and
 *                    `saveAndExit` on, because producing the SVG is an asynchronous round trip and
 *                    only a deliberate Save is worth one:
 *                      in   `{ event: 'save' }`      -> out `{ action: 'export', format: 'xmlsvg' }`
 *                      in   `{ event: 'export', data: 'data:image/svg+xml;base64,…' }`
 *                           -> `update:modelValue` with the decoded SVG text, then `save`
 *                      in   `{ event: 'exit' }`      -> `exit` (Save exits too; so does closing it)
 *
 * Emits: `update:modelValue`, `save`, and `exit` (svg mode only; the xml format never asks draw.io for
 * a way out of its own, see `noExitBtn`).
 */

// PROPS

const props = defineProps({
  /** The block's body: a draw.io XML document, or empty for a drawing that does not exist yet. */
  modelValue: {
    type: String,
    default: ''
  },
  /** The block's own parameters. Only `server` means anything here. */
  params: {
    type: Object,
    default: () => ({})
  },
  /*
    The other two halves of the editor contract, declared so they stay off this component's root
    element rather than because a canvas has any use for them: a drawing is drawn, not highlighted,
    and draw.io is the one editor that already knows what it is editing.
  */
  block: {
    type: Object,
    default: () => ({})
  },
  lang: {
    type: String,
    default: ''
  },
  /** What `modelValue` holds: draw.io's XML (`xml`), or a complete SVG embedding it (`svg`). */
  format: {
    type: String,
    default: 'xml',
    validator: (value) => ['xml', 'svg'].includes(value)
  }
})

// EMITS

const emit = defineEmits(['update:modelValue', 'save', 'exit'])

/**
 * The draw.io that answers when the block names none.
 *
 * `embed.diagrams.net` is the deployment draw.io publishes for exactly this, and it is a different
 * host from the `viewer.diagrams.net` the block reads a finished drawing from — which is why the
 * block's `server` prop has a default on neither side and means "the public services" when empty.
 */
const PUBLIC_EDITOR = 'https://embed.diagrams.net'

/** How long draw.io has to say `init` before the veil stops being a spinner and starts explaining. */
const READY_TIMEOUT = 20000

// DARK MODE

// -> The reader's effective theme, not the site's default: a user who has chosen light on a dark wiki
//    should be drawing on a light canvas
const dark = useDark()

// I18N

const { t } = useI18n()

// DATA

const frameEl = ref(null)

const state = reactive({
  ready: false,
  timedOut: false
})

let readyTimer = null

// -> svg mode: `save` has asked for an export that has not come back, and an `exit` that arrives in
//    that window is held until it has, or the host would close on a drawing it never received
let exportPending = false
let exitAfterExport = false
/*
  How long an export may take before it is given up on. draw.io answers one in well under a second;
  without a limit, an `exit` held for an export that never comes would hold the author in a drawing
  they have already left, with the overlay's own Close as the only way out.
*/
const EXPORT_TIMEOUT = 15000
let exportTimer = null

// COMPUTED

const server = computed(() => String(props.params.server || '').trim() || PUBLIC_EDITOR)

/** Where messages are sent, and the only place they are accepted from. */
const origin = computed(() => {
  try {
    return new URL(server.value).origin
  } catch {
    return ''
  }
})

const isSvg = computed(() => props.format === 'svg')

const editorUrl = computed(() => {
  /*
    `ui` is settled once, when the frame is built, and deliberately does not follow the reader
    switching theme underneath it: the parameter is read at load, so keeping the two in step would
    mean reloading draw.io — and reloading it mid-drawing is the one thing that would lose work.
  */
  const params = new URLSearchParams({
    embed: '1',
    proto: 'json',
    spin: '1',
    libraries: '1',
    // -> The overlay's own Cancel is the way out, and two of them beside each other say different
    //    things about the unsaved drawing. An svg drawing is the exception: its host has no Apply
    //    button, and draw.io's own Save and Exit are the whole of the way out
    noExitBtn: isSvg.value ? '0' : '1',
    saveAndExit: isSvg.value ? '1' : '0',
    ui: dark.isActive ? 'dark' : 'kennedy'
  })
  return `${server.value.replace(/\/+$/, '')}/?${params.toString()}`
})

// METHODS

function post(message) {
  frameEl.value?.contentWindow?.postMessage(JSON.stringify(message), origin.value || '*')
}

/** The text of a `data:…;base64,` URI, decoded as UTF-8 (`atob` alone gives one character per byte). */
function decodeDataUri(uri) {
  const base64 = String(uri ?? '').replace(/^data:[^,]*,/, '')
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)))
}

/**
 * One message from the frame.
 *
 * Both the window it came from and the origin it came from are checked. The window because any page
 * may post to any other, and this listener is on `window`; the origin because the frame's own
 * `contentWindow` is still whatever has been navigated into it.
 */
function onMessage(event) {
  if (event.source !== frameEl.value?.contentWindow) {
    return
  }
  if (origin.value && event.origin !== origin.value) {
    return
  }
  let message = null
  try {
    message = JSON.parse(event.data)
  } catch {
    // -> Not ours: draw.io speaks JSON here, and its other protocols do not
    return
  }
  switch (message.event) {
    case 'init':
      state.ready = true
      clearTimeout(readyTimer)
      // -> `autosave` is what makes the frame report every change, which is what Apply relies on
      if (isSvg.value) {
        // -> `xml` accepts a complete SVG that embeds the model as well as mxfile XML; empty is a new drawing
        post({ action: 'load', autosave: 0, saveAndExit: 1, xml: props.modelValue })
      } else {
        post({ action: 'load', autosave: 1, xml: props.modelValue })
      }
      break
    case 'autosave':
      emit('update:modelValue', message.xml ?? '')
      break
    case 'save':
      if (isSvg.value) {
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
        break
      }
      emit('update:modelValue', message.xml ?? '')
      emit('save')
      break
    case 'export':
      // -> draw.io answers an `xmlsvg` export as `format: 'svg'` (the request it echoes under `message`
      //    is what still says `xmlsvg`), so either spelling is the answer being waited for
      if (isSvg.value && (message.format === 'svg' || message.format === 'xmlsvg')) {
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
      break
    case 'exit':
      if (isSvg.value) {
        if (exportPending) {
          exitAfterExport = true
        } else {
          emit('exit')
        }
      }
      break
  }
}

// LIFECYCLE

onMounted(() => {
  window.addEventListener('message', onMessage)
  readyTimer = setTimeout(() => {
    state.timedOut = true
  }, READY_TIMEOUT)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  clearTimeout(readyTimer)
  clearTimeout(exportTimer)
})
</script>

<style lang="scss">
.block-content-drawio {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1 1 auto;

  &-frame {
    flex: 1 1 auto;
    border: 0;
    width: 100%;
    height: 100%;
  }

  /* -> Over the frame rather than instead of it: draw.io is loading behind this the whole time */
  &-veil {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 1rem;

    @at-root .body--light & {
      background-color: #fff;
    }
    @at-root .body--dark & {
      background-color: $dark-5;
    }
  }
}
</style>
