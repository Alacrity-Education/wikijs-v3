<template>
  <!--
    FORK-ONLY. The foot of the side column under the stacked layout, which has no icon rail and no
    buttons in the header row: both live here, as one labelled list under one heading
    (`actionsInSidebar`, `composables/stackedLayout.js`). Reader buttons first, as they sit in the
    header in the classic layout, then the page's own actions. Then, where the page has a discussion
    under its article, what the Talk view's column offers in the classic layout -- there being no such
    view -- with the same classes, so `_page-chrome.scss` lays the buttons out the same.

    The buttons act on state the page holds -- the discussion, the annotator, the panel this column is
    on a phone -- so they ask the page rather than reaching for it.
  -->
  <w-separator v-if="hasSections" />
  <div class="p-4 flex items-center">
    <w-icon class="me-2" name="la:cog" color="grey" />
    <div class="text-caption text-grey-7">{{ t('common.header.pageActions') }}</div>
  </div>
  <div class="p-2">
    <page-reader-actions v-if="!editorStore.isActive" />
    <page-actions-list v-if="!pageStore.notFound" />
  </div>
  <template v-if="talk">
    <w-separator />
    <div class="p-4 flex items-center">
      <w-icon class="me-2" name="la:comments" color="grey" />
      <div class="text-caption text-grey-7">{{ t('common.comments.commentsTitle') }}</div>
    </div>
    <div class="page-talk-actions pt-0">
      <w-btn
        class="acrylic-btn"
        flat
        no-caps
        color="primary"
        icon="la:comment-medical"
        :label="t('common.comments.newComment')"
        :disable="!talkView?.canStartComment"
        @click="emit('new-comment')" />
      <w-btn
        class="acrylic-btn"
        flat
        no-caps
        color="primary"
        icon="la:highlighter"
        :label="t('common.comments.newAnnotation')"
        :disable="!talkView?.canStartAnnotation"
        @click="emit('new-annotation')" />
      <!-- -> Only something to show where there is a passage still in the page to show; turning it
              off is always on offer while it is on -->
      <w-btn
        class="acrylic-btn"
        flat
        no-caps
        :color="dark.isActive ? `indigo-4` : `indigo`"
        :icon="showAnnotations ? `la:eye-slash` : `la:eye`"
        :label="
          showAnnotations
            ? t('common.comments.hideAllAnnotations')
            : t('common.comments.viewAllAnnotations')
        "
        :disable="!showAnnotations && !talkView?.annotationCount"
        @click="emit('toggle-annotations')">
        <!-- -> How many there are to show: the passages still in the article, open and resolved -->
        <template #append>
          <w-badge
            v-if="talkView?.annotationCount > 0"
            class="page-talk-actions-count"
            rounded
            :color="dark.isActive ? `indigo-4` : `indigo`"
            :label="talkView.annotationCount" />
        </template>
      </w-btn>
    </div>
  </template>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

import { useDark } from '@/composables/dark'

import { useEditorStore } from '@/stores/editor'
import { usePageStore } from '@/stores/page'

import PageActionsList from '@/components/stacked/PageActionsList.vue'
import PageReaderActions from '@/components/stacked/PageReaderActions.vue'

defineProps({
  /** Whether any of the column's own sections -- contents, tags, rating, last editor -- is above. */
  hasSections: {
    type: Boolean,
    default: false
  },
  /** Whether the page has a discussion under its article (`showStackedTalk`), to offer the buttons for. */
  talk: {
    type: Boolean,
    default: false
  },
  /**
   * That discussion's section (`StackedTalkSection`), once mounted: what may be started from it, and
   * how many annotations it holds. Null while its chunk is still on its way, which disables the buttons.
   */
  talkView: {
    type: Object,
    default: null
  },
  /** Whether every annotation is painted over the article -- View All Annotations is on. */
  showAnnotations: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['new-comment', 'new-annotation', 'toggle-annotations'])

const editorStore = useEditorStore()
const pageStore = usePageStore()

const dark = useDark()

const { t } = useI18n()
</script>
