<template>
  <!--
    FORK-ONLY. The page's path at the top of the side column, in place of the breadcrumb bar: the
    stacked layout while a page is read with the column beside it (`chromeInSidebar`). The trail wraps
    over several lines rather than being clipped (`_page-stacked.scss`), and carries the draft badge
    and the "Last modified on" date the bar would have. A rule closes it off from the column's own
    sections, where there are any.

    The trail, the separator and the date are the page view's own (`breadcrumbs`, `crumbSeparator`,
    `lastModified`), handed in rather than worked out a second time here.
  -->
  <div class="p-4 flex items-center">
    <w-icon class="me-2" name="la:sitemap" color="grey" />
    <div class="text-caption text-grey-7">{{ t('profile.pages.headerPath') }}</div>
  </div>
  <div class="page-sidebar-path px-4 pb-4">
    <w-breadcrumbs
      :items="items"
      :active-color="dark.isActive ? `grey-5` : `grey-7`"
      separator-color="grey">
      <template #separator><w-icon :name="separator" /></template>
    </w-breadcrumbs>
    <div class="mt-2 flex flex-wrap items-center gap-2">
      <w-badge
        v-if="pageStore.publishState === `draft`"
        class="uppercase"
        color="negative"
        :label="t(`editor.props.draft`)" />
      <div class="text-caption text-grey-6">
        <i18n-t keypath="common.page.lastModified">
          <template #date>
            <strong>{{ lastModified }}</strong>
          </template>
        </i18n-t>
      </div>
    </div>
  </div>
  <w-separator v-if="hasSections" />
</template>

<script setup>
import { useI18n } from 'vue-i18n'

import { useDark } from '@/composables/dark'

import { usePageStore } from '@/stores/page'

defineProps({
  /** The trail, root first, as the page view builds it for its breadcrumb bar. */
  items: {
    type: Array,
    required: true
  },
  /** The icon between two crumbs, which points down the trail. */
  separator: {
    type: String,
    required: true
  },
  /** The date the page was last written to, formatted for this reader. */
  lastModified: {
    type: String,
    required: true
  },
  /** Whether any of the column's own sections -- contents, tags, rating, last editor -- follows. */
  hasSections: {
    type: Boolean,
    default: false
  }
})

const pageStore = usePageStore()

const dark = useDark()

const { t } = useI18n()
</script>
