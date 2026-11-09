import { computed, toValue } from 'vue'

import { useEditorStore } from '@/stores/editor'
import { usePageStore } from '@/stores/page'
import { useSiteStore } from '@/stores/site'

/**
 * The stacked page layout (Admin → Theme → Page Layout), as the page view (`pages/Index.vue`) asks
 * about it. Fork-only: everything the layout adds to the page view is gathered here and in
 * `components/stacked/`, so that the view itself -- upstream's file -- carries little more than the
 * switches.
 *
 * Under it the Article / Talk / Links tab strip and the page-actions icon rail are gone: the article is
 * always shown, with the discussion and the list of pages linking here drawn under it
 * (`StackedTalkSection`, `StackedLinksSection`), and the page's actions move into the side column
 * (`StackedSidebarActions`). While a page is read on a wide viewport the path moves into that column
 * too (`StackedSidebarPath`) and the title into the article (`StackedInlineTitle`), so neither bar is
 * drawn above the columns; where the band stays, it is drawn without its row (`StackedPageHeader`).
 *
 * Every question the layout asks of the page -- whether the column is on screen, whether this is a
 * blog's or a board's front page, whether the column is a panel, whether the page has a discussion or
 * a links list -- is answered by the view's own computeds, handed in as refs or as getters. Getters
 * where the view declares them after calling this: its `showSidebar` reads `isStacked` back from here,
 * so one of the two has to be late-bound, and nothing here is read before the view has declared all
 * of them.
 *
 * @param {object} page The page view's answers, each a ref or a getter
 * @param {import('vue').MaybeRefOrGetter<boolean>} page.showSidebar The side column is on screen
 * @param {import('vue').MaybeRefOrGetter<boolean>} page.isBlog A blog's front page
 * @param {import('vue').MaybeRefOrGetter<boolean>} page.isFeedbackBoard A feedback board's front page
 * @param {import('vue').MaybeRefOrGetter<boolean>} page.tocIsPanel The column is a slide-in panel (phone)
 * @param {import('vue').MaybeRefOrGetter<boolean>} page.showTalkTab The page has a discussion to show
 * @param {import('vue').MaybeRefOrGetter<boolean>} page.showLinksTab The page has a links list to show
 */
export function useStackedLayout({
  showSidebar,
  isBlog,
  isFeedbackBoard,
  tocIsPanel,
  showTalkTab,
  showLinksTab
}) {
  const editorStore = useEditorStore()
  const pageStore = usePageStore()
  const siteStore = useSiteStore()

  /**
   * Whether the stacked page layout is on. `undefined`, which is every site that has not chosen, is the
   * classic layout.
   */
  const isStacked = computed(() => siteStore.theme.pageLayout === 'stacked')

  /*
    What the page and the theme ask of the column: the page's own switch and the theme's "off" position.
    In the stacked layout the column is also where the page's actions are -- there is no rail -- so it
    cannot be switched off without taking them with it. It stays, holding the actions alone, and the
    four sections these two settings govern (contents, tags, rating, last editor) are what go: the view
    gates each of them on this.
  */
  const sidebarSectionsOn = computed(
    () => pageStore.showSidebar && siteStore.theme.tocPosition !== 'off'
  )

  /**
   * Whether the page's actions sit in the side column rather than in the icon rail and the header row.
   * Only under the stacked layout, and only while that column is on screen holding them: an editor
   * session, a redirection, a site with its sidebar off and a blog's front page (whose column is its
   * own) all keep the column away, and a page whose actions went with it would have none -- so those
   * cases fall back to the classic placement. A feedback board's front page likewise fills the column
   * with its own sidebar.
   */
  const actionsInSidebar = computed(
    () => isStacked.value && toValue(showSidebar) && !toValue(isBlog) && !toValue(isFeedbackBoard)
  )

  /**
   * Stacked layout, page being read, side column on screen beside the article: the path moves into that
   * column and the title into the article, so the breadcrumb bar and the header band are not drawn. Any
   * other case keeps both bars -- the classic layout and the editor, but also a locked page, whose lock
   * screen stands in for the article and so has nowhere to draw the title, and a phone, where the column
   * is a panel slid in on request and a trail hidden in it would leave the reader with no way back out.
   */
  const chromeInSidebar = computed(
    () =>
      actionsInSidebar.value && !editorStore.isActive && !pageStore.isLocked && !toValue(tocIsPanel)
  )

  /*
    The stacked layout's two sections, drawn under the article on the same conditions the tabs have in
    the classic one -- the tabs' own conditions are all about the page, none about the strip -- and
    without the tab strip's. `showTalkTab` includes the built-in provider, the page's switch,
    `read:comments`, an existing, unlocked page that is not being edited, and not a blog front page or a
    redirection; `showLinksTab` the site and page switches and the same page tests.
  */
  const showStackedTalk = computed(() => isStacked.value && toValue(showTalkTab))
  const showStackedLinks = computed(() => isStacked.value && toValue(showLinksTab))

  return {
    isStacked,
    sidebarSectionsOn,
    actionsInSidebar,
    chromeInSidebar,
    showStackedTalk,
    showStackedLinks
  }
}
