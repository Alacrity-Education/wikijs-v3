<template>
  <!--
    The buttons a reader gets on a page while no editor is open: watch, print, the review tray, and
    Edit or Suggest edits. `PageHeader` shows them as a row of icons in its action bar; the stacked page
    layout shows them as a list in the side column. Same buttons, same rules for when each appears --
    only the shape differs, see `variant`.

    `display: contents` on the row, so the buttons lay out as direct children of the header's flex row
    exactly as they did before they lived here.
  -->
  <div class="page-reader-actions" :class="`is-${variant}`">
    <!--
      Watching a page is a state of it, so the button IS the state: filled and orange while the
      page is watched, an outline in grey while it is not. Same orange as Edit, because both are
      this reader's own hold on the page rather than decoration.

      `mdi` rather than the `la` this row otherwise uses, because Line Awesome has no filled bell
      to switch TO: its bell and its bell-solid carry an identical body in Iconify, so that pair
      drew one drawing in two colours. (Names left unquoted on purpose — the icon bundler scans
      this file for quoted references and would keep bundling an icon nothing draws.)

      Not offered on a redirection: a watch is an offer to be told when a page's content changes,
      and nobody is reading this one — they are passing through it.
    -->
    <w-btn
      :class="[rowSpacing, { 'is-ringing': state.bellRinging }]"
      v-if="userStore.authenticated && !isRedirect"
      flat
      dense
      :icon="pageStore.isWatching ? `mdi:bell` : `la:bell`"
      :color="pageStore.isWatching ? `deep-orange-9` : `grey`"
      :label="isList ? watchLabel : null"
      :no-caps="isList"
      :aria-label="watchLabel"
      :aria-pressed="pageStore.isWatching"
      @click="toggleWatch">
      <w-tooltip v-if="!isList">{{ watchLabel }}</w-tooltip>
    </w-btn>
    <w-btn
      :class="rowSpacing"
      v-if="siteStore.theme.showPrintBtn"
      flat
      dense
      icon="la:print"
      color="grey"
      :label="isList ? t(`common.actions.print`) : null"
      :no-caps="isList"
      :aria-label="t(`common.actions.print`)"
      @click="printPage">
      <w-tooltip v-if="!isList">{{ t('common.actions.print') }}</w-tooltip>
    </w-btn>
    <!--
      Only for whoever reviews this page: the server answers `canReview` from the approval rules
      and the reviewer's own permissions — with the page itself — so nothing here has to know how
      that is decided, or ask about it.

      An empty queue is grey and an empty tray, sitting with Print as one more thing available
      rather than one more thing to do; something waiting fills the tray and turns it orange, the
      colour this row uses for what belongs to the reader. The count is on the badge either way.

      A redirection takes no suggestions -- see the button below -- so there is never a queue on
      one to review.
    -->
    <w-btn
      :class="rowSpacing"
      v-if="pageStore.canReview && !isRedirect"
      flat
      dense
      :color="pendingCount > 0 ? `deep-orange-9` : `grey`"
      :icon="isList ? inboxIcon : undefined"
      :label="isList ? t(`inbox.pendingReview`) : null"
      :no-caps="isList"
      :aria-label="t(`inbox.pendingReview`)">
      <!--
        The badge is a sibling of the icon, not a child of it: WIcon renders a bare `<svg>` and no
        slot, so anything written inside it is dropped — and an HTML badge could not live inside an
        SVG in any case. It floats against the button, which is the positioned box here.
      -->
      <w-icon v-if="!isList" :name="inboxIcon" />
      <w-badge v-if="pendingCount > 0" color="deep-orange-9" text-color="white" rounded floating>
        <strong>{{ pendingCount }}</strong>
      </w-badge>
      <w-tooltip v-if="!isList">{{ t('inbox.pendingReview') }}</w-tooltip>
      <!--
        Down from the button's far edge, like every other menu hanging off this row: the panel is
        wider than the button and the button is near the end of the row, so aligning the edges on
        that side is what keeps it on screen -- the right ones, or the left ones on a right-to-left
        interface, where the actions are at the left of the window.
      -->
      <w-menu
        class="translucent-menu"
        :anchor="`bottom ${endSide}`"
        :self="`top ${endSide}`"
        auto-close>
        <w-list padding style="min-width: 320px">
          <w-item v-if="pendingCount < 1">
            <w-item-section>
              <w-item-label caption>{{ t('inbox.reviewNone') }}</w-item-label>
            </w-item-section>
          </w-item>
          <w-item
            v-for="submission of pageStore.pendingSubmissions"
            :key="submission.id"
            clickable
            @click="reviewSubmission(submission)">
            <w-item-section class="items-center" avatar>
              <w-icon class="text-deep-orange-9" name="la:file-alt" size="sm" />
            </w-item-section>
            <w-item-section>
              <w-item-label>
                {{ submission.author.name || t('inbox.reviewUnknownAuthor') }}
              </w-item-label>
              <w-item-label caption>{{ humanizeDate(submission.createdAt) }}</w-item-label>
            </w-item-section>
            <w-item-section side v-if="submission.isStale">
              <w-badge color="warning" rounded>{{ t('inbox.reviewStale') }}</w-badge>
            </w-item-section>
          </w-item>
        </w-list>
      </w-menu>
    </w-btn>
    <!--
      Not `v-else-if` on the block below: changes made from the page properties panel put the header
      into the pending state without an editor behind it, and hiding Edit there left no way back into
      the content at all.
    -->
    <template v-if="userStore.can(`write:pages`)">
      <w-btn
        class="acrylic-btn"
        :class="rowSpacing"
        flat
        icon="la:edit"
        color="deep-orange-9"
        :label="t(`common.actions.edit`)"
        :aria-label="t(`common.actions.edit`)"
        no-caps
        @click="editPage" />
    </template>
    <!--
      For a reader who may read the page but not change it, and whose groups an approval rule lets
      suggest edits to it. Same place and same shape as Edit, because it is the same intent -- what
      differs is where the result goes.

      Never on a redirection. A suggestion is a rewrite of a page's text put in front of a reviewer,
      and a redirection has no text -- what it has is a target, which is a decision about where a
      path leads rather than a contribution to read. The server still answers `canSuggestEdits` from
      the approval rules, which are written against paths and know nothing about editors; this is
      the one place that asks for it.
    -->
    <template v-else-if="pageStore.canSuggestEdits && !isRedirect">
      <w-btn
        class="acrylic-btn"
        :class="rowSpacing"
        flat
        icon="la:edit"
        color="deep-orange-9"
        :label="suggestLabel"
        :aria-label="suggestLabel"
        no-caps
        @click="suggestEdits" />
    </template>
  </div>
</template>

<script setup>
import { computed, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { loading } from '@/composables/loading'
import { notify } from '@/composables/notify'

import { useCommonStore } from '@/stores/common'
import { usePageStore } from '@/stores/page'
import { useSiteStore } from '@/stores/site'
import { useUserStore } from '@/stores/user'

/**
 * How long the bell swings for, in milliseconds. Matches the `w-bell-ring` animation below — the class
 * has to come off once it has played, or the next watch would not play it again.
 */
const BELL_RING_MS = 700

const props = defineProps({
  /**
   * `row`: horizontal icon buttons (tooltips carry the names), for the page header's action bar.
   * `list`: a vertical list for a side column -- each action a full-width, left-aligned flat button
   * with its icon and a visible label.
   *
   * The caller decides WHEN to render this (while an editor is open there is nothing for a reader to
   * do), so it does not look at the editor itself.
   */
  variant: {
    type: String,
    default: 'row',
    validator: (value) => ['row', 'list'].includes(value)
  }
})

// STORES

const commonStore = useCommonStore()
const pageStore = usePageStore()
const siteStore = useSiteStore()
const userStore = useUserStore()

// ROUTER

const router = useRouter()

// I18N

const { t } = useI18n()

// COMPUTED

const isList = computed(() => props.variant === 'list')

/** The gap between icons in the row; the list stacks its buttons and spaces them with `gap`. */
const rowSpacing = computed(() => (isList.value ? '' : 'ms-4'))

const watchLabel = computed(() =>
  pageStore.isWatching ? t('common.page.unwatch') : t('common.page.watch')
)

/** How many suggestions are waiting on this page, which is what the review badge counts. */
const pendingCount = computed(() => pageStore.pendingSubmissions.length)

const inboxIcon = computed(() => (pendingCount.value > 0 ? 'mdi:inbox-full' : 'la:inbox'))

const suggestLabel = computed(() =>
  pageStore.hasOpenSuggestion
    ? t('common.actions.continueSuggestion')
    : t('common.actions.suggestEdits')
)

/**
 * The physical side the row ends on, which is the side the action buttons are near and so the side a
 * menu hanging off one of them aligns to. `WMenu` places in physical terms, being positioned against
 * the window rather than laid out in the row.
 */
const endSide = computed(() =>
  siteStore.localeDir(commonStore.locale) === 'rtl' ? 'left' : 'right'
)

/**
 * Whether this is a redirection — one being read, edited or created alike, since `pageCreate` puts the
 * editor on the page store as well.
 *
 * What it takes out of here is everything addressed to a READER of the page: watching it,
 * suggesting a change to it, and reviewing the suggestions. Nobody stays on a redirection long enough
 * for any of those to mean anything. Edit stays, because it belongs to whoever maintains it.
 */
const isRedirect = computed(() => pageStore.editor === 'redirect')

// DATA

const state = reactive({
  /**
   * Whether the bell is mid-swing. Set for as long as the animation runs and cleared afterwards, so
   * that watching a page again a minute later rings it again — a class left on plays once and never
   * plays a second time.
   */
  bellRinging: false
})

// METHODS

/**
 * Into the editor, which is a navigation and nothing else.
 *
 * The page view's route watcher is what opens it — `/_edit/...` is its branch, and it calls
 * `pageEdit` with the path and locale out of the URL. Opening it from here as well would load the
 * page twice and, worse, would leave the editor open at an address that says nothing about it.
 */
function editPage() {
  router.push(pageStore.editPath)
}

/**
 * Open the editor on an edit suggestion. Picks up the reader's own pending suggestion if they have
 * one, which the server decides -- see `pageSuggest`.
 */
async function suggestEdits() {
  loading.show()
  try {
    await pageStore.pageSuggest()
  } catch (err) {
    notify({
      type: 'negative',
      message: t('common.page.suggestFailed'),
      caption: err.message
    })
  }
  loading.hide()
}

function printPage() {
  window.print()
}

function humanizeDate(val) {
  return Temporal.Instant.from(val).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

/**
 * Open one suggestion for review, remembering where it was opened from.
 *
 * `from=page` is what sends the reviewer back here when they are done, rather than to the inbox queue
 * they never came through.
 */
function reviewSubmission(submission) {
  router.push({ path: `/_inbox/review/${submission.id}`, query: { from: 'page' } })
}

/**
 * Watch the page, or stop watching it.
 *
 * The bell rings on the way IN only: a swing is the page announcing that it will now tell you about
 * itself, and playing the same flourish for switching that off would say the opposite thing with the
 * same gesture. The store moves before the request answers, so the icon flips under the pointer.
 */
async function toggleWatch() {
  const watching = !pageStore.isWatching
  if (watching) {
    state.bellRinging = true
    setTimeout(() => {
      state.bellRinging = false
    }, BELL_RING_MS)
  }
  try {
    await pageStore.pageWatch(watching)
  } catch (err) {
    notify({
      type: 'negative',
      message: t(watching ? 'common.page.watchFailed' : 'common.page.unwatchFailed'),
      caption: err.message
    })
  }
}
</script>

<style scoped lang="scss">
.page-reader-actions.is-row {
  display: contents;
}

/*
  The side-column shape: one button per line, each as wide as the column with its icon and label
  against the start edge. Orange and grey keep the meaning they have in the row -- orange for what is
  this reader's own hold on the page, grey for what is merely available.

  Reaches `WBtn`'s root through the scoped attribute a child's root element inherits.
*/
.page-reader-actions.is-list {
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

/*
  The bell swinging as a page starts being watched.

  On the icon inside the button rather than on the button itself, so the ripple, the hover tint and the
  hit area all stay where they are while only the drawing moves. `transform-origin` at the top centre
  is what makes it swing from its mounting instead of spinning about its middle.

  `:deep`, because the icon is rendered by `WBtn` and a scoped rule would not reach into it.
*/
.is-ringing :deep(svg) {
  animation: w-bell-ring 0.7s ease-in-out;
  transform-origin: top center;
}

@keyframes w-bell-ring {
  0% {
    transform: rotate(0);
  }
  15% {
    transform: rotate(18deg);
  }
  30% {
    transform: rotate(-14deg);
  }
  45% {
    transform: rotate(10deg);
  }
  60% {
    transform: rotate(-7deg);
  }
  75% {
    transform: rotate(4deg);
  }
  100% {
    transform: rotate(0);
  }
}

/* -> A swinging bell says nothing the colour change does not; for a reader who asked for less motion
   it is noise with a vestibular cost, so it simply does not swing. */
@media (prefers-reduced-motion: reduce) {
  .is-ringing :deep(svg) {
    animation: none;
  }
}
/* -> Twinned under the Reduce Motion profile setting; see `css/_animation.scss` */
.body--reduce-motion .is-ringing :deep(svg) {
  animation: none;
}
</style>
