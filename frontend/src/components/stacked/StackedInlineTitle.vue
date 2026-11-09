<template>
  <!--
    FORK-ONLY. The page's icon, title and description at the top of the article, so they scroll with
    it: the stacked layout while a page is read with the side column beside it (`chromeInSidebar`),
    where the header band is not drawn. In a `.page-measure` box of its own, so that a theme that
    centres the content (`.is-centered`, `_page-chrome.scss`) holds it to the same measure as the
    article below. The title and the subtitle wear the header's own classes, so they are set in its
    type; the box's spacing is in `_page-stacked.scss`.
  -->
  <div class="page-measure">
    <div class="page-inline-header flex items-start gap-3" :lang="pageStore.locale">
      <w-icon
        class="flex-none rounded"
        :class="pageIconColorClass(pageStore.iconColor)"
        :name="pageStore.icon"
        size="40px" />
      <div class="min-w-0 flex-1">
        <div class="text-h4 page-header-title" :dir="pageDir">{{ pageStore.title }}</div>
        <div
          class="text-subtitle2 page-header-subtitle"
          v-if="pageStore.description"
          :dir="pageDir">
          {{ pageStore.description }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

import { usePageStore } from '@/stores/page'
import { useSiteStore } from '@/stores/site'

import { pageIconColorClass } from '@/helpers/pageIconColors'

const pageStore = usePageStore()
const siteStore = useSiteStore()

/** The page's own direction, for its title and description. */
const pageDir = computed(() => siteStore.localeDir(pageStore.locale))
</script>
