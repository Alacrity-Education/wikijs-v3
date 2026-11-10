<template>
  <!--
    FORK-ONLY. The page's own actions -- properties, history, source, convert, rerender, duplicate,
    rename, delete -- for the stacked page layout's side column (`StackedSidebarActions.vue`), in place
    of the icon rail the classic layout draws down the far edge of the page. Drawn in two parts, which
    the column puts in two places:

    - `primary`: Properties, a labelled full-width button styled as Edit is beside it -- plus, while a
      suggestion or a new page is being written, the line saying so.
    - `icons`: everything else as icon-only buttons, each named by its tooltip and its `aria-label`,
      flowing into the column's icon grid (this part's root is `display: contents`). What the rail
      keeps behind its "..." menu -- convert, rerender -- is inline here, there being room for it.

    THIS MIRRORS `PageActionsCol.vue`, BY HAND. That file is upstream's and is left untouched so that it
    merges cleanly, so its buttons -- in the same order, behind the same gates, running the same
    handlers -- are written out again here with only their shape changed. Whenever upstream changes the
    rail or its handlers, bring the change over. Already here, for instance: `canDuplicate`, which asks
    for source access here and `write:pages` somewhere on the site rather than `write:pages` on this
    page.
  -->
  <div
    v-if="part === `primary`"
    class="page-actions-list is-primary"
    :class="editorStore.isActive ? `is-editor` : ``">
    <!-- -> Disabled, not hidden, for a redirection: see the rail -->
    <w-btn
      v-if="userStore.can(`write:pages`)"
      class="acrylic-btn"
      flat
      no-caps
      icon="la:pen-nib"
      color="deep-orange-9"
      :label="t('common.actions.properties')"
      :disable="isRedirect"
      @click="togglePageProperties" />
    <span
      v-if="editorStore.isActive && [`create`, `suggest`].includes(editorStore.mode)"
      class="page-actions-list-mode text-caption"
      >{{
        editorStore.mode === `suggest`
          ? t('common.actions.suggestedEdit')
          : t('common.actions.newPage')
      }}</span
    >
  </div>
  <div v-else class="page-actions-list is-icons">
    <template v-if="userStore.can(`write:pages`)">
      <w-btn
        v-if="flagsStore.experimental"
        flat
        icon="la:project-diagram"
        color="grey-7"
        :aria-label="t('editor.pageData.title')"
        disable
        @click="togglePageData">
        <w-tooltip>{{ t('editor.pageData.title') }}</w-tooltip>
      </w-btn>
      <w-btn
        v-if="editorStore.isActive && !isRedirect"
        flat
        icon="mdi:image-sync-outline"
        :color="hasPendingAssets ? `deep-orange-9` : `grey-7`"
        aria-label="Pending Asset Uploads">
        <w-badge v-if="hasPendingAssets" color="deep-orange-9" text-color="white" rounded floating>
          <strong>{{ editorStore.pendingAssets.length }}</strong>
        </w-badge>
        <w-tooltip>Pending Asset Uploads</w-tooltip>
        <w-menu ref="menuPendingAssets" anchor="top left" self="top right" :offset="[10, 0]">
          <w-card style="width: 450px; max-width: 90vw">
            <w-card-section class="card-header">
              <w-icon name="img:/_assets/icons/color-data-pending.svg" left size="sm" />
              <span>Pending Asset Uploads</span>
            </w-card-section>
            <w-card-section v-if="!hasPendingAssets"
              >There are no assets pending uploads.</w-card-section
            >
            <w-list v-else separator>
              <w-item v-for="item of editorStore.pendingAssets" :key="item.id">
                <w-item-section side><w-icon name="la:file-image" /></w-item-section>
                <w-item-section>{{ item.file.name }}</w-item-section>
                <w-item-section side>
                  <w-btn
                    class="acrylic-btn"
                    color="negative"
                    round
                    icon="la:times"
                    size="xs"
                    flat
                    @click="removePendingAsset(item)" />
                </w-item-section>
              </w-item>
            </w-list>
            <w-card-section class="card-actions">
              <em class="text-caption"
                >Assets that are pasted or dropped onto this page will be held here until the page
                is saved.</em
              >
            </w-card-section>
          </w-card>
        </w-menu>
      </w-btn>
    </template>
    <w-btn
      v-if="showHistory"
      flat
      icon="la:history"
      color="grey-7"
      :aria-label="t('history.title')"
      @click="viewPageHistory">
      <w-tooltip>{{ t('history.title') }}</w-tooltip>
    </w-btn>
    <w-btn
      v-if="showSource"
      flat
      icon="la:code"
      color="grey-7"
      :aria-label="t('pageSource.title')"
      @click="viewPageSource">
      <w-tooltip>{{ t('pageSource.title') }}</w-tooltip>
    </w-btn>
    <!-- -> What the rail keeps in its "..." menu, inline: same gates, see `showPageActions` -->
    <template v-if="showPageActions">
      <w-btn
        v-if="userStore.can(`write:pages`) && canConvert"
        flat
        icon="la:atom"
        color="grey-7"
        :aria-label="t('convertPage.action')"
        @click="convertPage">
        <w-tooltip>{{ t('convertPage.action') }}</w-tooltip>
      </w-btn>
      <w-btn
        v-if="userStore.can(`write:pages`) && hasBody"
        flat
        icon="la:magic"
        color="grey-7"
        aria-label="Rerender Page"
        @click="rerenderPage">
        <w-tooltip>Rerender Page</w-tooltip>
      </w-btn>
      <w-btn
        v-if="flagsStore.experimental"
        flat
        icon="la:sun"
        color="grey-7"
        aria-label="View Backlinks"
        disable>
        <w-tooltip>View Backlinks</w-tooltip>
      </w-btn>
    </template>
    <!-- -> Hidden outright while a suggestion is being written: see the rail -->
    <template v-if="!(editorStore.isActive && [`create`, `suggest`].includes(editorStore.mode))">
      <w-btn
        v-if="canDuplicate"
        flat
        icon="la:copy"
        color="grey-7"
        :aria-label="t('common.actions.duplicate')"
        @click="duplicatePage">
        <w-tooltip>{{ t('common.actions.duplicate') }}</w-tooltip>
      </w-btn>
      <w-btn
        v-if="userStore.can(`manage:pages`)"
        flat
        icon="la:share"
        color="grey-7"
        :aria-label="renameLabel"
        @click="renamePage">
        <w-tooltip>{{ renameLabel }}</w-tooltip>
      </w-btn>
      <w-btn
        v-if="userStore.can(`delete:pages`)"
        flat
        icon="la:trash"
        color="grey-7"
        :aria-label="t('common.page.delete')"
        @click="deletePage">
        <w-tooltip>{{ t('common.page.delete') }}</w-tooltip>
      </w-btn>
    </template>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { dialog } from '@/composables/dialog'
import { notify } from '@/composables/notify'
import { notifyRelinked } from '@/helpers/pageRelink'
import { pageDeleteLanding } from '@/helpers/pageDeleteLanding'

import { useEditorStore } from '@/stores/editor'
import { useFlagsStore } from '@/stores/flags'
import { usePageStore } from '@/stores/page'
import { useSiteStore } from '@/stores/site'
import { useUserStore } from '@/stores/user'

/*
  THE SCRIPT MIRRORS `PageActionsCol.vue`'S, BY HAND -- see the template. Every computed and every
  handler below is that file's, under the same name; only the pending-assets menu ref is this list's
  own.
*/

// PROPS

defineProps({
  /** Which half to draw: Properties (`primary`) or the icon buttons (`icons`). See the template. */
  part: {
    type: String,
    default: 'icons',
    validator: (value) => ['primary', 'icons'].includes(value)
  }
})

// STORES

const editorStore = useEditorStore()
const flagsStore = useFlagsStore()
const pageStore = usePageStore()
const siteStore = useSiteStore()
const userStore = useUserStore()

// ROUTER

const router = useRouter()

// I18N

const { t } = useI18n()

// REFS

const menuPendingAssets = ref(null)

// COMPUTED

const renameLabel = computed(() => `${t('common.actions.rename')} / ${t('common.actions.move')}`)

const hasPendingAssets = computed(() => editorStore.pendingAssets?.length > 0)

/**
 * Whether this page has anywhere to be converted to.
 *
 * Both halves matter: the server says which editors produce this page's content type, and the site
 * says which of those anybody can open. A redirection satisfies neither.
 */
const canConvert = computed(() =>
  (pageStore.convertibleTo ?? []).some((editor) => siteStore.activeEditors.includes(editor))
)

/**
 * Whether the page this list is for is a redirection — one being read, edited or created alike, since
 * `pageCreate` puts the editor on the page store as well. A redirection has no text, so most of this
 * list is about something that is not there.
 */
const isRedirect = computed(() => pageStore.editor === 'redirect')

/**
 * Whether the page on screen holds text somebody wrote.
 *
 * False for the editors that keep a settings document where a page keeps content: a redirection
 * holds where it points, a blog how it lists the posts under it and a feedback board how it lists its
 * ideas. None has a source worth showing a reader, and none can be re-rendered — the endpoint refuses
 * any editor but markdown.
 */
const hasBody = computed(() => !['redirect', 'blog', 'feedback'].includes(pageStore.editor))

/**
 * Whether the "..." menu has anything to show: the disjunction of the three entries' own conditions,
 * spelled out, because with none of them true it opened an empty panel. Keep this in step with the
 * entries themselves.
 */
const hasPageActions = computed(
  () =>
    (userStore.can('write:pages') && (canConvert.value || hasBody.value)) || flagsStore.experimental
)

/*
  Whoever may write the page may read its source too — the editor is what opens it — so the button is
  not hidden from an author whose rule grants the one and not the other. The API decides the same way.
*/
const canViewSource = computed(
  () =>
    userStore.can('read:source') || userStore.can('write:pages') || userStore.can('manage:pages')
)

/**
 * Whether Duplicate Page is offered.
 *
 * Not `write:pages` on THIS page: a copy is a new page, saved wherever the author picks, and the save
 * is checked there. What duplicating needs of the source is its source, which is how a page can serve
 * as a template for authors who may not edit the template itself. So: source access here, and
 * `write:pages` somewhere on the site, or there is nowhere the copy could go.
 */
const canDuplicate = computed(() => canViewSource.value && userStore.canWriteOnSite)

/**
 * Whether this page exists on the server yet. `id` is `0` until the first save — see `pageCreate` —
 * and the two buttons below it gate are both questions about a stored page.
 */
const isSaved = computed(() => Boolean(pageStore.id))

/** What a page's stored TEXT can be asked about, which needs a stored page and a page with text. */
const showHistory = computed(
  () => !isRedirect.value && isSaved.value && userStore.can('read:history')
)
const showSource = computed(() => hasBody.value && isSaved.value && canViewSource.value)

/**
 * Whether the "..." menu is offered at all. Never while an editor is open, whatever the page: both of
 * its actions are answers to a question about the saved page, asked from a screen showing an unsaved
 * one.
 */
const showPageActions = computed(
  () => hasPageActions.value && !isRedirect.value && !editorStore.isActive
)

// METHODS

function togglePageProperties() {
  siteStore.$patch({
    sideDialogComponent: 'PagePropertiesDialog',
    sideDialogShown: true
  })
}

function togglePageData() {
  siteStore.$patch({
    sideDialogComponent: 'PageDataDialog',
    sideDialogShown: true
  })
}

function viewPageHistory() {
  siteStore.$patch({ overlay: 'PageHistory', overlayOpts: {} })
}

function viewPageSource() {
  siteStore.$patch({ overlay: 'PageSource', overlayOpts: {} })
}

/**
 * Move the page to a different editor. The dialog is what decides whether that is safe -- see
 * `PageConvertDialog` -- and what reloads, since it knows whether anything was written.
 */
function convertPage() {
  dialog({
    component: defineAsyncComponent(() => import('@/components/PageConvertDialog.vue'))
  })
}

function rerenderPage() {
  dialog({
    component: defineAsyncComponent(() => import('@/components/RerenderPageDialog.vue')),
    componentProps: {
      id: pageStore.id
    }
  }).onOk(() => {
    pageStore.pageLoad({ id: pageStore.id })
  })
}

function duplicatePage() {
  dialog({
    component: defineAsyncComponent(() => import('@/components/TreeBrowserDialog.vue')),
    componentProps: {
      mode: 'duplicatePage',
      folderPath: '',
      itemId: pageStore.id,
      itemTitle: pageStore.title,
      itemFileName: pageStore.path,
      locale: pageStore.locale
    }
  }).onOk((newPageOpts) => {
    pageStore.pageDuplicate({
      sourcePageId: pageStore.id,
      path: newPageOpts.path,
      title: newPageOpts.title,
      locale: newPageOpts.locale
    })
  })
}

function renamePage() {
  dialog({
    component: defineAsyncComponent(() => import('@/components/TreeBrowserDialog.vue')),
    componentProps: {
      mode: 'renamePage',
      folderPath: '',
      itemId: pageStore.id,
      itemTitle: pageStore.title,
      itemFileName: pageStore.path,
      locale: pageStore.locale
    }
  }).onOk(async (renamedPageOpts) => {
    try {
      // -> The destination is a locale as well as a path: the same path in another locale is a move
      if (renamedPageOpts.path === pageStore.path && renamedPageOpts.locale === pageStore.locale) {
        await pageStore.pageRename({ id: pageStore.id, title: renamedPageOpts.title })
        notify({
          type: 'positive',
          message: 'Page renamed successfully.'
        })
      } else {
        const relinked = await pageStore.pageMove({
          id: pageStore.id,
          path: renamedPageOpts.path,
          title: renamedPageOpts.title,
          locale: renamedPageOpts.locale,
          updateLinks: renamedPageOpts.updateLinks
        })
        notify({
          type: 'positive',
          message: 'Page moved successfully.'
        })
        notifyRelinked(relinked, t)
      }
    } catch (err) {
      notify({
        type: 'negative',
        message: err.message
      })
    }
  })
}

function deletePage() {
  // -> Captured before the dialog opens: once the page is gone, the store may already be moving on
  const deleted = {
    siteId: siteStore.id,
    locale: pageStore.locale,
    path: pageStore.path,
    localePrefix: siteStore.localeUrlPrefix(pageStore.locale)
  }
  dialog({
    component: defineAsyncComponent(() => import('@/components/PageDeleteDialog.vue')),
    componentProps: {
      pageId: pageStore.id,
      pageName: pageStore.title
    }
  }).onOk(async () => {
    // -> Fork: another page of the same folder rather than the home page (`helpers/pageDeleteLanding.js`)
    router.replace(await pageDeleteLanding(deleted))
  })
}

function removePendingAsset(item) {
  URL.revokeObjectURL(item.blobUrl)
  editorStore.pendingAssets = editorStore.pendingAssets.filter((a) => a.id !== item.id)
  if (editorStore.pendingAssets.length < 1) {
    menuPendingAssets.value?.hide()
  }
}
</script>

<style lang="scss">
/* Properties, shaped as Edit is beside it: as wide as the column, icon and label from the start edge */
.page-actions-list.is-primary {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;

  .w-btn {
    width: 100%;
    justify-content: flex-start;
    text-align: start;
  }
}

/* The icon buttons belong to the column's grid (`StackedSidebarActions.vue`), not to a box of their own */
.page-actions-list.is-icons {
  display: contents;
}

.page-actions-list-mode {
  padding: 0.5rem 1rem;
  color: $deep-orange-9;
  font-weight: 500;
}
</style>
