<template>
  <!--
    FORK-ONLY. The page's discussion as a section under the article (stacked layout), in place of the
    Talk view the classic layout puts behind a tab. Inside the article's measure, so it shares its
    width, and inside the scrolling column, so it scrolls with it. `id="talk"`, so that a `#talk`
    fragment scrolls to it (`onHashChange` in `pages/Index.vue`). Hidden in print (`_page-stacked.scss`).

    The heading row is the one the side column's sections use. `is-embedded` on the view drops the
    centred 900px measure the Talk view holds its threads to, since the article column already sets the
    width (`_page-stacked.scss`).
  -->
  <section id="talk" class="page-stacked-section page-stacked-talk">
    <div class="page-stacked-heading flex items-center">
      <w-icon class="me-2" name="la:comments" color="grey" />
      <div class="text-caption text-grey-7">{{ t('common.comments.commentsTitle') }}</div>
    </div>
    <page-talk
      ref="talk"
      class="is-embedded"
      :content-root="contentRoot"
      :content-revision="contentRevision"
      @locate-annotation="emit('locate-annotation', $event)" />
  </section>
</template>

<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import LoadingGeneric from '@/components/LoadingGeneric.vue'

/* -> On demand, as the page view fetches it: the Talk view brings a markdown renderer with it */
const PageTalk = defineAsyncComponent({
  loader: () => import('@/components/PageTalk.vue'),
  loadingComponent: LoadingGeneric
})

defineProps({
  /** The element the article was rendered into, which annotations are looked for in. */
  contentRoot: {
    type: Object,
    default: null
  },
  /**
   * Bumped by the page whenever the article's DOM is rewritten without `pageStore.render` changing
   * (glossary links), so that the annotations are looked for again. The classic Talk view never needs
   * this: it is mounted in place of the article, not beside it.
   */
  contentRevision: {
    type: Number,
    default: 0
  }
})

/** From an annotation in the discussion to its passage in the article, passed up unchanged. */
const emit = defineEmits(['locate-annotation'])

const { t } = useI18n()

/** The Talk view itself, once its chunk has arrived. */
const talk = ref(null)

/*
  The Talk view's surface, passed through, so that the page can hold this section under the same ref
  it holds the classic Talk view under (`talkView`) and ask either the same questions: what the side
  column's New Comment and New Annotation buttons may offer, and -- after passages were posted from the
  annotator while this stayed mounted -- a reload.
*/
defineExpose({
  canStartComment: computed(() => talk.value?.canStartComment),
  canStartAnnotation: computed(() => talk.value?.canStartAnnotation),
  annotationCount: computed(() => talk.value?.annotationCount),
  startNewComment: () => talk.value?.startNewComment(),
  reload: () => talk.value?.reload()
})
</script>
