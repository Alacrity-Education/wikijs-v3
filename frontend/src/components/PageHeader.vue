<template>
  <!--
    In the interface's language and direction: the row is chrome -- an icon, then what it is called,
    then what can be done with it -- and on a right-to-left interface it runs from the right. The title
    and description keep the PAGE's direction on their own text, below, which in the editor need not be
    the same one: an editor is not a page path, so the interface there stays in the reader's language.
  -->
  <!-- -> `--page-header-tint`: the hint of the page's color the bar's gradient carries, see `_page-chrome.scss` -->
  <div
    class="page-header flex flex-wrap"
    :style="{ '--page-header-tint': pageIconColorValue(pageStore.iconColor) }"
    :lang="commonStore.locale"
    :dir="siteStore.localeDir(commonStore.locale)">
    <!-- PAGE ICON -->
    <div class="flex-none ps-4 flex items-center">
      <w-btn
        class="rounded"
        v-if="isEditing"
        padding="none"
        :size="iconSize"
        color="primary"
        flat
        :aria-label="t(`editor.props.icon`)"
        :style="{ minHeight: iconSize }">
        <!-- -> The same size the icon has when the page is merely being read; see the branch below -->
        <w-icon :class="iconColorClass" :name="pageStore.icon" :size="iconSize" />
        <!-- -> Not `v-model`: writing the store is only half of what picking an icon means here, and
                the other half is telling the editor the page changed. See `setIcon`. -->
        <w-menu content-class="shadow-7">
          <icon-picker-dialog :model-value="pageStore.icon" @update:model-value="setIcon" />
        </w-menu>
      </w-btn>
      <w-icon
        class="rounded"
        :class="iconColorClass"
        v-else
        :name="pageStore.icon"
        :size="iconSize" />
    </div>
    <!-- PAGE HEADER -->
    <!--
      In the editor the title and the description are the fields, edited where they sit rather than
      through a button and a popup. They keep the heading type they have when the page is being read:
      what tells an author they can type here is the hover tint and the caret, not a box drawn around
      the text.

      The text is NOT interpolated into the editable elements. Vue would rewrite the text node on every
      keystroke as the store echoes it back, and a rewritten text node puts the caret at the start of
      it. `syncEditable` writes it instead, and only when the two have actually diverged.
    -->
    <!--
      Centred rather than top-aligned: with no description the title is the only line in this column,
      and left at the top it sat above the middle of the icon beside it. A page that has one is taller
      than everything else in the row, so there is nothing to centre and this changes nothing.
    -->
    <!--
      The title and description are the page's own words, so they take its language and direction --
      on the text alone rather than on the column, which would push them to the far side of the icon
      they belong to.
    -->
    <div class="min-w-0 flex-1 flex flex-col justify-center p-2 sm:p-4" :lang="pageStore.locale">
      <div class="text-h4 page-header-title">
        <span
          v-if="isEditing"
          ref="titleEl"
          class="page-header-editable"
          :dir="contentDir"
          :class="{ 'is-empty': !pageStore.title }"
          contenteditable="plaintext-only"
          role="textbox"
          aria-multiline="false"
          :aria-label="t(`editor.props.title`)"
          :data-placeholder="t(`editor.props.title`)"
          @input="onEditableInput(`title`, $event)"
          @blur="onEditableBlur(`title`, $event)"
          @keydown.enter.prevent="$event.target.blur()" />
        <span v-else :dir="contentDir">{{ pageStore.title }}</span>
      </div>
      <div class="text-subtitle2 page-header-subtitle">
        <span
          v-if="isEditing"
          ref="descriptionEl"
          class="page-header-editable"
          :dir="contentDir"
          :class="{ 'is-empty': !pageStore.description }"
          contenteditable="plaintext-only"
          role="textbox"
          aria-multiline="false"
          :aria-label="t(`editor.props.shortDescription`)"
          :data-placeholder="t(`editor.props.shortDescription`)"
          @input="onEditableInput(`description`, $event)"
          @blur="onEditableBlur(`description`, $event)"
          @keydown.enter.prevent="$event.target.blur()" />
        <span v-else :dir="contentDir">{{ pageStore.description }}</span>
      </div>
    </div>
    <!-- PAGE ACTIONS -->
    <!--
      `has-editor-actions` is what keeps this row on a phone, where it is otherwise hidden: what it
      holds while a page is being read is a handful of icons for a wide screen, but while a page is
      being WRITTEN it holds the only way to save or to get back out. See the stylesheet.
    -->
    <div
      v-if="showActionsRow"
      class="page-header-actions flex-none p-4 flex items-center justify-end"
      :class="{ 'has-editor-actions': hasEditorActions }">
      <!--
        What a reader gets while no editor is open. Under the stacked page layout these live in the
        page's side column instead (rendered by the page itself), which says so through
        `actionsInSidebar` -- and says the opposite whenever that column is not on screen, so the
        buttons are never nowhere.
      -->
      <page-reader-actions v-if="!editorStore.isActive && !actionsInSidebar" variant="row" />
      <template v-if="editorStore.isActive">
        <!--
          Whoever else has this page open in an editor. Renders nothing when that is nobody, which is
          also what it renders whenever there is no collaboration session at all.
        -->
        <collab-presence class="me-2" />
        <w-btn
          class="ms-4 acrylic-btn"
          icon="la:question-circle"
          flat
          color="grey"
          :href="siteStore.docsBase + `/guide/editors/${editorStore.editor}`"
          target="_blank"
          type="a">
          <w-tooltip>{{ t(`common.actions.viewDocs`) }}</w-tooltip>
        </w-btn>
      </template>
      <template v-if="editorStore.isActive || editorStore.hasPendingChanges">
        <w-btn
          class="acrylic-btn ms-2"
          flat
          icon="la:times"
          color="negative"
          :label="
            editorStore.hasPendingChanges ? t(`common.actions.discard`) : t(`common.actions.close`)
          "
          :aria-label="
            editorStore.hasPendingChanges ? t(`common.actions.discard`) : t(`common.actions.close`)
          "
          no-caps
          @click="discardChanges" />
        <w-btn
          class="acrylic-btn ms-2"
          v-if="isSuggesting"
          flat
          icon="la:paper-plane"
          color="positive"
          :label="t(`common.actions.submitEdits`)"
          :aria-label="t(`common.actions.submitEdits`)"
          :disabled="!editorStore.hasPendingChanges"
          no-caps
          @click="submitSuggestion" />
        <w-btn
          class="acrylic-btn ms-2"
          v-else-if="editorStore.mode === `create`"
          flat
          icon="la:check"
          color="positive"
          :label="t(`editor.createPage`)"
          :aria-label="t(`editor.createPage`)"
          no-caps
          @click="createPage" />
        <w-btn-group class="ms-2" v-else flat>
          <w-btn
            class="acrylic-btn"
            flat
            icon="la:check"
            color="positive"
            :label="t(`common.actions.saveChanges`)"
            :aria-label="t(`common.actions.saveChanges`)"
            :disabled="!editorStore.hasPendingChanges"
            no-caps
            @click.exact="saveChanges(false)"
            @click.ctrl.exact="saveChanges(true)" />
          <template v-if="editorStore.isActive">
            <w-separator vertical dark />
            <w-btn
              class="acrylic-btn"
              flat
              icon="la:check-double"
              color="positive"
              :aria-label="t(`common.actions.saveAndClose`)"
              :disabled="!editorStore.hasPendingChanges"
              @click="saveChanges(true)">
              <w-tooltip>{{ t(`common.actions.saveAndClose`) }}</w-tooltip>
            </w-btn>
          </template>
        </w-btn-group>
      </template>
    </div>
  </div>
</template>

<script setup>
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch
} from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { dialog } from '@/composables/dialog'
import { loading } from '@/composables/loading'
import { notify } from '@/composables/notify'
import { useMinWidth } from '@/composables/screen'

import { useCommonStore } from '@/stores/common'
import { useEditorStore } from '@/stores/editor'
import { useFlagsStore } from '@/stores/flags'
import { usePageStore } from '@/stores/page'
import { useSiteStore } from '@/stores/site'
import { useUserStore } from '@/stores/user'

import CollabPresence from '@/components/CollabPresence.vue'
import IconPickerDialog from '@/components/IconPickerDialog.vue'
import PageReaderActions from '@/components/PageReaderActions.vue'
import { apiErrorMessage } from '@/helpers/apiError'
import { pageIconColorClass, pageIconColorValue } from '@/helpers/pageIconColors'

const props = defineProps({
  /**
   * Whether the page draws the reader's buttons (watch, print, review, edit) in its side column, as the
   * stacked layout does while that column is on screen. Off, they are in this row as always.
   */
  actionsInSidebar: {
    type: Boolean,
    default: false
  }
})

// STORES

const commonStore = useCommonStore()
const editorStore = useEditorStore()
const flagsStore = useFlagsStore()
const pageStore = usePageStore()
const siteStore = useSiteStore()
const userStore = useUserStore()

// ROUTER

const router = useRouter()
const route = useRoute()

// I18N

const { t } = useI18n()

// COMPUTED

/**
 * At or above the `sm` breakpoint (`css/tailwind.css`), which is this app's phone boundary — below it
 * the header is compacted, since a 64px icon and a 34px title over a row of icons is most of a phone
 * screen before the page has said anything.
 */
const isAtLeastSm = useMinWidth(600)
const isPhoneViewport = computed(() => !isAtLeastSm.value)

/**
 * The page icon, halved on a phone.
 *
 * Bound rather than left to a media query: `WIcon` renders `size` as an inline `font-size`, which no
 * stylesheet can outrank without `!important`.
 */
const iconSize = computed(() => (isPhoneViewport.value ? '32px' : '64px'))

/** The page's own icon color, or the site's primary color when it has none. */
const iconColorClass = computed(() => pageIconColorClass(pageStore.iconColor))

/** The direction the page's own locale is written in, for its title and description. */
const contentDir = computed(() => siteStore.localeDir(pageStore.locale))

/**
 * Whether this row holds an editor's own controls — Save, Discard, Submit — rather than only the
 * actions offered to a reader. Those must survive the phone layout: the properties panel puts the
 * header into the pending state with no editor open, so `isActive` alone is not the question.
 */
const hasEditorActions = computed(() => editorStore.isActive || editorStore.hasPendingChanges)

/**
 * Whether the row has anything to show. With the reader's buttons in the side column a page that is
 * only being read leaves it empty, and an empty row would still be a padded gap under the title; with
 * an editor's controls (`hasEditorActions`) it stays, phones included -- see the stylesheet.
 */
const showActionsRow = computed(() => !props.actionsInSidebar || hasEditorActions.value)

/**
 * Suggesting an edit rather than making one: the editor is open on a submission, and everything about
 * the page other than its content is out of scope.
 */
const isSuggesting = computed(() => editorStore.isActive && editorStore.mode === 'suggest')

/**
 * Editing the page itself, which is what makes the icon, title and description editable in place.
 * Excludes suggest mode, where those are page properties the submitter has no say over.
 */
const isEditing = computed(() => editorStore.isActive && !isSuggesting.value)

// DATA

const state = reactive({
  /**
   * Whether a save is on the wire. Read only by `savePageFromShortcut`, where the keystroke can repeat
   * faster than the request comes back; see the note there.
   */
  isSaving: false
})

// REFS

/** The two in-place fields, which only exist while the page itself is being edited. */
const titleEl = ref(null)
const descriptionEl = ref(null)

// WATCHERS

/*
  Opening the editor is what mounts the two fields, so it is also what fills them. `immediate` covers
  arriving with the editor already open, where the elements appear in the same tick as this runs.
*/
watch(
  () => isEditing.value,
  (editing) => editing && seedEditables(),
  { immediate: true }
)

/*
  Changed from somewhere else -- the properties panel edits both of these, and a save replaces the whole
  page -- so the field follows. A change that came FROM the field is already in the element and
  `syncEditable` leaves it alone.
*/
watch(
  () => pageStore.title,
  (title) => syncEditable(titleEl.value, title)
)
watch(
  () => pageStore.description,
  (description) => syncEditable(descriptionEl.value, description)
)

// LIFECYCLE

/*
  Ctrl+S in an editor, emitted by whichever editor is open (`EditorMarkdown.vue`). The listener lives
  here because the buttons do.
*/
onMounted(() => {
  EVENT_BUS.on('savePage', savePageFromShortcut)
})

onBeforeUnmount(() => {
  EVENT_BUS.off('savePage', savePageFromShortcut)
})

// METHODS

/**
 * The keyboard asking for the Save button.
 *
 * Which button that is depends on the mode -- a suggestion is submitted, a page that has no row yet is
 * created through the save-as dialog, everything else is saved in place -- so this dispatches the same
 * three ways the template does, and stays disabled where they are. A shortcut that saved a page the
 * button in front of the author could not would be a different action wearing its name.
 */
function savePageFromShortcut() {
  if (isSuggesting.value) {
    if (editorStore.hasPendingChanges) {
      submitSuggestion()
    }
    return
  }
  if (editorStore.mode === 'create') {
    // -> No pending-changes guard, matching its button: a page being created has nothing to compare to
    createPage()
    return
  }
  /*
    `state.isSaving` is only ever consulted here. A button cannot be pressed thirty times a second, but
    Ctrl+S held down auto-repeats, and every repeat that landed before the answer came back would write
    another version into the page's history. The two branches above need no such guard: both open a
    dialog, which takes the focus off the editor and ends the repeat.
  */
  if (editorStore.hasPendingChanges && !state.isSaving) {
    saveChanges(false)
  }
}

/**
 * Put a value into a contenteditable without disturbing a caret that is already in it.
 *
 * Writing `textContent` replaces the node's text and collapses the selection to its start, so it is
 * only done when the element and the store have actually diverged — which is never mid-keystroke,
 * since the keystroke is where the store's value came from.
 */
function syncEditable(el, value) {
  if (el && el.textContent !== (value ?? '')) {
    el.textContent = value ?? ''
  }
}

/** Both fields, from the store. Call after they mount; they do not exist outside the editor. */
async function seedEditables() {
  await nextTick()
  syncEditable(titleEl.value, pageStore.title)
  syncEditable(descriptionEl.value, pageStore.description)
}

/**
 * The icon picked from the header.
 *
 * The same two steps the title and the description take below, and for the same reason: an icon is part
 * of the page, so changing it has to leave the editor holding an unsaved change. Bound through the event
 * rather than `v-model` because that wrote the store and nothing else -- Save Changes stayed disabled
 * until something else was edited, and closing the editor threw the new icon away without a word.
 */
function setIcon(icon) {
  pageStore.icon = icon
  editorStore.lastChangeTimestamp = Temporal.Now.instant()
}

function onEditableInput(field, event) {
  // -> Clearing the field leaves a browser-inserted `<br>` behind, which contributes nothing to the
  //    text but does hold a second line open under the placeholder
  if (event.target.textContent === '' && event.target.innerHTML !== '') {
    event.target.innerHTML = ''
  }
  pageStore[field] = event.target.textContent
  // -> What the tag editor and the properties panel do for their own edits: the header is a place a
  //    page gets changed, so it owes the same "unsaved changes" signal
  editorStore.lastChangeTimestamp = Temporal.Now.instant()
}

/*
  Tidied on the way out rather than as it is typed: a pasted line break or a run of spaces has no
  business in a title, but collapsing them under the caret would move it while someone is still going.
*/
function onEditableBlur(field, event) {
  const tidied = event.target.textContent.replace(/\s+/g, ' ').trim()
  if (tidied !== pageStore[field]) {
    pageStore[field] = tidied
    editorStore.lastChangeTimestamp = Temporal.Now.instant()
  }
  syncEditable(event.target, tidied)
}

async function discardChanges() {
  const hadPendingChanges = editorStore.hasPendingChanges
  const wasSuggesting = isSuggesting.value

  /*
    Thrown away, which is said before anything navigates: the router asks before leaving an editor
    with unsaved edits, and the browser buffer keeps whatever is unsaved when the editor closes --
    neither of which is what the author just asked for.
  */
  editorStore.settleChanges()

  /*
    Abandoning a page that is being written, which is a different thing from reverting an edit: there
    is nothing stored to go back to, so the editor closes and the reader is put back on the site.

    `isActive` is part of the test, not just the mode. This button also appears with no editor open at
    all -- the properties panel writes straight to the page store, and this is how those changes are
    dropped -- and that is an edit to a page that exists, however the editor was last used.
  */
  if (editorStore.isActive && editorStore.mode === 'create') {
    editorStore.closeEditor()

    /*
      Is it the home page in create mode? In whichever locale it was being written -- the test used to
      name `en`, which meant abandoning the FRENCH home page dropped the reader onto the English site
      root with no welcome screen and no explanation.
    */
    const localeRoot = siteStore.localeUrlPrefix(pageStore.locale) || '/'
    if (pageStore.path === '' || pageStore.path === 'home') {
      siteStore.overlay = 'Welcome'
    }

    router.replace(localeRoot)
    return
  }

  loading.show()
  try {
    /*
      The page is put back, and only then does the editor close. The other order draws the page view
      for a moment at the route the editor was on, which a redirection reads as "nobody is holding
      me" and acts on -- taking the author to its target instead of back to the page they discarded.
    */
    // -> Every field of it, not just `isActive`, and the editor's own path with them: see
    //    `leaveEditor`. `cancelPageEdit` has already navigated, so this only settles the state.
    await pageStore.cancelPageEdit()
    await pageStore.leaveEditor()
    if (hadPendingChanges) {
      notify({
        type: 'positive',
        // -> Nothing was reverted in the suggest case: the page never changed, the draft did
        message: wasSuggesting
          ? t('common.page.suggestDiscarded')
          : 'Page has been reverted to the last saved state.'
      })
    }
  } catch (err) {
    // -> The editor closes either way: the reader asked to leave it, and a page that would not
    //    reload is not a reason to keep them in it
    await pageStore.leaveEditor()
    notify({
      type: 'negative',
      message: 'Failed to reload page state.'
    })
  }
  loading.hide()
}

async function saveChanges(closeAfter = false) {
  if (siteStore.features.reasonForChange !== 'off') {
    dialog({
      component: defineAsyncComponent(() => import('../components/PageReasonForChangeDialog.vue')),
      componentProps: {
        required: siteStore.features.reasonForChange === 'required'
      }
    }).onOk(async ({ reason }) => {
      editorStore.$patch({
        reasonForChange: reason
      })
      saveChangesCommit(closeAfter)
    })
  } else {
    saveChangesCommit(closeAfter)
  }
}

async function saveChangesCommit(closeAfter = false) {
  await processPendingAssets()
  loading.show()
  state.isSaving = true
  try {
    await pageStore.pageSave()
    notify({
      type: 'positive',
      message: 'Page saved successfully.'
    })
    if (closeAfter) {
      /*
        The editor closes onto the page it was opened on — `editorExitPath`, which for a redirection
        carries the query that stops the page taking the author straight to the target they have just
        chosen. `leaveEditor` navigates before it closes anything, which is what keeps that query in
        front of the page view rather than behind it.
      */
      await pageStore.leaveEditor()
    }
  } catch (err) {
    notify({
      type: 'negative',
      message: 'Failed to save page changes.',
      caption: err.message
    })
  } finally {
    state.isSaving = false
  }
  loading.hide()
}

async function createPage() {
  // Handle home page creation flow
  if (pageStore.path === 'home') {
    await processPendingAssets()
    loading.show()
    try {
      await pageStore.pageSave()
      notify({
        type: 'positive',
        message: 'Homepage created successfully.'
      })
      editorStore.closeEditor()
      // -> The home page that was just written, not the site root: unprefixed, the router sends it to
      //    the PRIMARY locale, so creating the French home page landed on the English one
      router.replace(pageStore.editorExitPath)
    } catch (err) {
      notify({
        type: 'negative',
        message: 'Failed to create homepage.',
        caption: err.message
      })
    }
    loading.hide()
    return
  }

  // All other pages
  dialog({
    component: defineAsyncComponent(() => import('../components/TreeBrowserDialog.vue')),
    componentProps: {
      mode: 'savePage',
      folderPath: '',
      itemTitle: pageStore.title,
      itemFileName: pageStore.path,
      locale: pageStore.locale
    }
  }).onOk(async ({ path, title, locale }) => {
    pageStore.$patch({
      title,
      path,
      // -> The dialog is where the locale is settled for a page that has none yet, so what it
      //    hands back is what the page is written in
      locale
    })
    /*
      After the patch above, and before the save: pending assets are uploaded into the folder the page
      is in, and until this dialog answered, the page was not anywhere yet. Uploading first would have
      filed everything pasted into a new page against wherever the editor was opened from.
    */
    await processPendingAssets()

    loading.show()
    try {
      await pageStore.pageSave()
      notify({
        type: 'positive',
        message: 'Page created successfully.'
      })
      editorStore.closeEditor()
    } catch (err) {
      notify({
        type: 'negative',
        message: 'Failed to create page.',
        caption: err.message
      })
    }
    loading.hide()
  })
}

async function processPendingAssets() {
  if (editorStore.pendingAssets?.length > 0) {
    return new Promise((resolve, reject) => {
      dialog({
        component: defineAsyncComponent(
          () => import('../components/UploadPendingAssetsDialog.vue')
        ),
        persistent: true
      })
        .onOk(resolve)
        .onCancel(reject)
    })
  }
}

/**
 * Send the suggestion, asking a guest who they are first: nothing else records that, and a reviewer
 * has to be able to answer them.
 */
async function submitSuggestion() {
  if (!userStore.authenticated) {
    dialog({
      component: defineAsyncComponent(() => import('../components/SuggestionGuestDialog.vue'))
    }).onOk((guest) => submitSuggestionCommit(guest))
    return
  }
  submitSuggestionCommit()
}

async function submitSuggestionCommit(guest = {}) {
  loading.show()
  try {
    await pageStore.pageSubmitSuggestion(guest)
    // -> Back to the page as everyone else sees it: what was typed is now a suggestion waiting for a
    //    reviewer, not a version of the page, so leaving the editor open on it would be a lie
    editorStore.closeEditor()
    await pageStore.pageLoad({ id: pageStore.id })
    notify({
      type: 'positive',
      message: t('common.page.suggestSubmitted'),
      // -> Only an account can be matched to a suggestion afterwards, so only a logged in author is
      //    told they can come back to it; for a guest that would be a promise nothing here can keep
      caption: userStore.authenticated
        ? t('common.page.suggestSubmittedHint')
        : t('common.page.suggestSubmittedHintGuest')
    })
  } catch (err) {
    notify({
      type: 'negative',
      message: t('common.page.suggestSubmitFailed'),
      caption: apiErrorMessage(err)
    })
  }
  loading.hide()
}

function notImplemented() {
  notify({
    type: 'negative',
    message: 'Not implemented'
  })
}
</script>

<style scoped lang="scss">
/*
  The phone layout of this row.

  The actions go, all of them -- Watch, Print, the review queue, Edit -- because they are icons squeezed
  against the right edge of a row that has no room for the title as it is. Nothing is lost that is not
  reachable elsewhere: Print is the browser's own menu, and a page is edited on a machine with a
  keyboard. An editor already open keeps its controls, or there would be no way to save or leave it.

  The title's own size comes down on the same breakpoint, and the text column's padding with it -- which
  together are most of what brings the bar's height down, `_page-chrome.scss` taking the fixed 95px off
  there. Both live in that stylesheet rather than here: they are worn by every header, and a scoped rule
  reaches only this one's markup.
*/
@media (max-width: $breakpoint-xs-max) {
  .page-header-actions:not(.has-editor-actions) {
    display: none;
  }
}

/*
  The two headings, while they are also the fields.

  No border and no focus ring: at rest each one has to read exactly as it does when the page is being
  read, which is the whole point of editing them where they sit. What says "type here" is the hover
  tint, the caret, and -- while a field is empty -- the placeholder below.

  The padding is cancelled by an equal negative margin, so the text keeps the position it has outside
  the editor and only the tint is inset from it.
*/
.page-header-editable {
  display: inline-block;
  padding: 0 4px;
  margin: 0 -4px;
  border-radius: 4px;
  outline: none;
  cursor: text;
  transition: background-color 0.15s var(--ease-standard);

  &:hover {
    background-color: rgb(0 0 0 / 0.06);
  }
  &:focus {
    background-color: rgb(0 0 0 / 0.09);
  }

  @at-root .body--dark & {
    &:hover {
      background-color: rgb(255 255 255 / 0.08);
    }
    &:focus {
      background-color: rgb(255 255 255 / 0.12);
    }
  }
}

/*
  Keyed off the store rather than `:empty`, which a cleared field can fail: the browser leaves a `<br>`
  behind and the element stops counting as empty even though it looks it.
*/
.page-header-editable.is-empty::before {
  content: attr(data-placeholder);
  opacity: 0.4;
  /* -> Decoration: it must not be selectable, and it must never end up in the value */
  pointer-events: none;
  user-select: none;
}
</style>
