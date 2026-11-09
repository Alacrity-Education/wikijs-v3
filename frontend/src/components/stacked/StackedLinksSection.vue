<template>
  <!--
    FORK-ONLY. The pages linking here as a section under the article and its discussion (stacked
    layout), in place of the Links view the classic layout puts behind a tab. `id="links"` for the
    `#links` fragment (`onHashChange` in `pages/Index.vue`); hidden in print (`_page-stacked.scss`).

    `v-show` rather than `v-if` on the count: the list has to stay mounted to fetch, and the section is
    only drawn once the list turns out to have something in it. The heading carries the count the Links
    view's own title bar carries, and `embedded` tells the view to leave that bar out.
  -->
  <section v-show="state.count > 0" id="links" class="page-stacked-section page-stacked-links">
    <div class="page-stacked-heading flex items-center">
      <w-icon class="me-2" name="la:link" color="grey" />
      <div class="text-caption text-grey-7">{{ t('common.links.title') }}</div>
      <w-space />
      <div class="text-caption text-grey-6">
        {{ t('common.links.count', state.count, { count: state.count }) }}
      </div>
    </div>
    <page-links class="is-embedded" embedded @loaded="(n) => (state.count = n)" />
  </section>
</template>

<script setup>
import { defineAsyncComponent, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import LoadingGeneric from '@/components/LoadingGeneric.vue'

import { usePageStore } from '@/stores/page'

/* -> On demand, as the page view fetches it: a request as well as a chunk */
const PageLinks = defineAsyncComponent({
  loader: () => import('@/components/PageLinks.vue'),
  loadingComponent: LoadingGeneric
})

const pageStore = usePageStore()

const { t } = useI18n()

const state = reactive({
  /** How many pages link here, as the list last loaded them. */
  count: 0
})

/* -> A count that belongs to the page before would flash up first: the list reloads on the same change */
watch(
  () => pageStore.id,
  () => {
    state.count = 0
  }
)
</script>
