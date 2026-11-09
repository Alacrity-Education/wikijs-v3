<template>
  <!--
    FORK-ONLY. The header band of a page being read under the stacked layout while its actions are in
    the side column (`actionsInSidebar`) but the band itself still has to be drawn (`chromeInSidebar`
    off): the column is a slide-in panel on a phone, or the lock screen stands where the title would
    go. The icon, the title and the description, and no actions row -- the reader's buttons are in the
    column, and an empty row would still be a padded gap under the title. Never with an editor open:
    the column, and so this, goes away with it.

    THE BAND MIRRORS THE READING STATE OF `PageHeader.vue`, BY HAND: same element, same classes and
    custom properties, same language and direction, so that `_page-chrome.scss` draws it the same. That
    file is upstream's and is left untouched so that it merges cleanly. Whenever upstream changes the
    header's reading markup, bring the change over.

    `PageHeader` itself is drawn instead while a change is pending with no editor open -- the properties
    panel writes straight to the page store -- because Save and Discard live in its row and nowhere
    else. Its row then also carries the reader's buttons, which upstream's header has no way to leave
    out, beside the same buttons in the column, for as long as the change is pending.
  -->
  <page-header v-if="editorStore.hasPendingChanges" />
  <div
    v-else
    class="page-header flex flex-wrap"
    :style="{
      '--page-header-tint': pageIconColorValue(pageStore.iconColor),
      '--page-header-icon-size': pageStore.icon ? iconSize : '0px'
    }"
    :lang="commonStore.locale"
    :dir="siteStore.localeDir(commonStore.locale)">
    <!-- PAGE ICON -->
    <div class="page-header-icon flex-none ps-4 flex items-center">
      <w-icon class="rounded" :class="iconColorClass" :name="pageStore.icon" :size="iconSize" />
    </div>
    <!-- PAGE HEADER -->
    <div
      class="page-header-text min-w-0 flex-1 flex flex-col justify-center p-2 sm:p-4"
      :lang="pageStore.locale">
      <div class="text-h4 page-header-title">
        <span :dir="contentDir">{{ pageStore.title }}</span>
      </div>
      <div class="text-subtitle2 page-header-subtitle">
        <span :dir="contentDir">{{ pageStore.description }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

import { useMinWidth } from '@/composables/screen'

import { useCommonStore } from '@/stores/common'
import { useEditorStore } from '@/stores/editor'
import { usePageStore } from '@/stores/page'
import { useSiteStore } from '@/stores/site'

import PageHeader from '@/components/PageHeader.vue'
import { pageIconColorClass, pageIconColorValue } from '@/helpers/pageIconColors'

// STORES

const commonStore = useCommonStore()
const editorStore = useEditorStore()
const pageStore = usePageStore()
const siteStore = useSiteStore()

// COMPUTED

/** At or above the `sm` breakpoint, which is `PageHeader`'s phone boundary: the icon is halved below it. */
const isAtLeastSm = useMinWidth(600)
const iconSize = computed(() => (isAtLeastSm.value ? '64px' : '32px'))

/** The page's own icon color, or the site's primary color when it has none. */
const iconColorClass = computed(() => pageIconColorClass(pageStore.iconColor))

/** The direction the page's own locale is written in, for its title and description. */
const contentDir = computed(() => siteStore.localeDir(pageStore.locale))
</script>
