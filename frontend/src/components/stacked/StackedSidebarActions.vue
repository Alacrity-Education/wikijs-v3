<template>
  <!--
    FORK-ONLY. The stacked layout's own sections of the side column, which has no icon rail and no
    buttons in the header row (`actionsInSidebar`, `composables/stackedLayout.js`). Drawn after the
    contents and the tags and before the rating and the last editor (`Index.vue`), in this order:

    - Comments, where the page has a discussion under its article: what the Talk view's column offers
      in the classic layout -- there being no such view -- with the same classes, so `_page-chrome.scss`
      lays the buttons out the same.
    - Page actions: the two things a page is mostly opened in the side column for -- Edit (or Suggest
      edits) and Properties -- as labelled buttons as wide as the column, then everything else as a
      grid of icon-only buttons named by their tooltips, five to a row.

    The buttons act on state the page holds -- the discussion, the annotator, the panel this column is
    on a phone -- so they ask the page rather than reaching for it.
  -->
  <template v-if="talk">
    <w-separator v-if="hasSections" />
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
  <w-separator v-if="hasSections || talk" />
  <div class="p-4 flex items-center">
    <w-icon class="me-2" name="la:cog" color="grey" />
    <div class="text-caption text-grey-7">{{ t('common.header.pageActions') }}</div>
  </div>
  <div class="stacked-page-actions px-4 pb-4">
    <page-reader-actions v-if="!editorStore.isActive" part="primary" />
    <page-actions-list v-if="!pageStore.notFound" part="primary" />
    <!-- -> Both lists' icons in one grid, the page's own first: each list's icon part is
            `display: contents`, so its buttons are this grid's cells -->
    <div class="stacked-page-actions-icons">
      <page-actions-list v-if="!pageStore.notFound" part="icons" />
      <page-reader-actions v-if="!editorStore.isActive" part="icons" />
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

import { useDark } from '@/composables/dark'

import { useEditorStore } from '@/stores/editor'
import { usePageStore } from '@/stores/page'

import PageActionsList from '@/components/stacked/PageActionsList.vue'
import PageReaderActions from '@/components/stacked/PageReaderActions.vue'

defineProps({
  /** Whether any of the column's own sections is above this one: the contents or the tags. */
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

<style lang="scss">
.stacked-page-actions {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* -> Set apart from the labelled buttons above it, where there are any: a reader may have none */
.stacked-page-actions > :not(:empty) ~ .stacked-page-actions-icons {
  margin-top: 0.5rem;
}

/*
  Five to a row in the 300px column: wide enough for a finger, and a row of five reads as a toolbar
  rather than a list. Each button fills its cell, so the hover tint is a tile rather than a circle
  around the glyph.
*/
.stacked-page-actions-icons {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 2px;

  /* -> The two lists' wrappers are always there, so `:empty` would never hold: no button, no grid */
  &:not(:has(.w-btn)) {
    display: none;
  }

  /* -> A list's own wrapper is `display: contents`, so the grid's cells are one level further down */
  > * > .w-btn {
    width: 100%;
    min-height: 2.5rem;
  }
}
</style>
