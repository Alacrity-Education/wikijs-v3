<template>
  <teleport to="body">
    <transition name="image-lightbox">
      <div
        v-if="current"
        ref="overlayEl"
        class="image-lightbox"
        role="dialog"
        aria-modal="true"
        :aria-label="current.name || t('common.imageViewer.enlarge')"
        tabindex="-1"
        @click="close"
        @keydown="onOverlayKeydown">
        <img
          v-if="!loaded"
          class="image-lightbox-img is-preview"
          :src="current.previewSrc"
          :alt="current.name" />
        <img v-else class="image-lightbox-img" :src="current.originalSrc" :alt="current.name" />
        <w-spinner
          v-if="!loaded"
          class="image-lightbox-spinner"
          size="36px"
          :aria-label="t('common.imageViewer.loading')" />
        <button
          ref="closeEl"
          type="button"
          class="image-lightbox-close"
          :aria-label="t('common.actions.close')"
          @click.stop="close">
          <w-icon name="la:times" size="24px" />
        </button>
        <p v-if="current.name" class="image-lightbox-caption">{{ current.name }}</p>
      </div>
    </transition>
  </teleport>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * Click-to-enlarge for the images in a page's rendered content. Nothing is drawn on the page: a
 * qualifying image only gets `cursor: zoom-in` (see `_page-contents.scss`) and is made reachable by
 * keyboard (`role="button"`, `tabindex="0"`). The stored HTML is never touched; the attributes are
 * set here, in the live DOM, as images load.
 *
 * Delegated on `root` (the `.page-contents` element), so content replaced by `v-html` or a live
 * re-render needs no re-binding: a capture-phase `load` listener and a MutationObserver mark images.
 *
 * Which images qualify: loaded, natural width of at least MIN_WIDTH, not an SVG, not an emoji or
 * draw.io diagram, not inside a link, not inside any `block-*` element, not `data-original-image`.
 * The enlarged view loads the original, i.e. the `src` without the query string of a scaled copy
 * (`/_files/<path>?w=<width>`), never `currentSrc`.
 */
const props = defineProps({
  /** The element holding the rendered content. */
  root: {
    type: Object,
    default: null
  }
})

const MIN_WIDTH = 200
const MARK = 'data-enlargeable'

const { t } = useI18n()

const current = ref(null)
const loaded = ref(false)
const overlayEl = ref(null)
const closeEl = ref(null)

let opener = null
let observer = null
let boundRoot = null
let loader = null
let previousOverflow = ''

function isSvg(src) {
  return /\.svg(\?|#|$)/i.test(src) || src.startsWith('data:image/svg')
}

/** Whether `img` is one the lightbox leaves alone, going by where it sits and what it is. */
function isExcluded(img, root) {
  if (img.hasAttribute('data-original-image')) return true
  if (img.classList.contains('emoji') || img.classList.contains('diagram-image')) return true
  for (let el = img.parentElement; el && el !== root; el = el.parentElement) {
    if (el.tagName === 'A' || el.tagName.startsWith('BLOCK-')) return true
  }
  return false
}

function name(img) {
  return (img.getAttribute('alt') || img.getAttribute('title') || '').trim()
}

function mark(img) {
  const src = img.getAttribute('src') || ''
  const ok =
    img.complete &&
    img.naturalWidth >= MIN_WIDTH &&
    src &&
    !isSvg(src) &&
    !isExcluded(img, boundRoot)
  if (!ok) {
    if (img.hasAttribute(MARK)) {
      for (const attr of [MARK, 'role', 'tabindex', 'aria-label']) img.removeAttribute(attr)
    }
    return
  }
  const label = name(img)
  img.setAttribute(MARK, '')
  img.setAttribute('role', 'button')
  img.setAttribute('tabindex', '0')
  img.setAttribute(
    'aria-label',
    label ? t('common.imageViewer.enlargeNamed', { name: label }) : t('common.imageViewer.enlarge')
  )
}

function markAll() {
  if (!boundRoot) return
  for (const img of boundRoot.querySelectorAll('img')) mark(img)
}

/** The full-resolution address: a scaled copy's `?w=` query is dropped, nothing else is rewritten. */
function originalOf(img) {
  const src = img.getAttribute('src')
  const query = src.indexOf('?')
  return query === -1 ? src : src.slice(0, query)
}

function enlargeables() {
  return boundRoot ? [...boundRoot.querySelectorAll(`img[${MARK}]`)] : []
}

function show(img) {
  const originalSrc = originalOf(img)
  loaded.value = false
  current.value = {
    originalSrc,
    previewSrc: img.currentSrc || img.src,
    name: name(img),
    source: img
  }
  loader = new Image()
  const mine = loader
  loader.onload = () => {
    if (loader === mine) loaded.value = true
  }
  // -> A failed original falls back to what the page already has, rather than a spinner forever
  loader.onerror = () => {
    if (loader === mine && current.value) {
      current.value.originalSrc = current.value.previewSrc
      loaded.value = true
    }
  }
  loader.src = originalSrc
}

function open(img) {
  opener = img
  show(img)
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onDocumentKeydown)
  nextTick(() => closeEl.value?.focus({ preventScroll: true }))
}

function close() {
  if (!current.value) return
  loader = null
  current.value = null
  document.body.style.overflow = previousOverflow
  document.removeEventListener('keydown', onDocumentKeydown)
  if (opener?.isConnected) opener.focus({ preventScroll: true })
  opener = null
}

function step(delta) {
  const list = enlargeables()
  const index = list.indexOf(current.value?.source)
  if (list.length < 2 || index === -1) return
  show(list[(index + delta + list.length) % list.length])
}

function onDocumentKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  } else if (event.key === 'ArrowRight') {
    step(1)
  } else if (event.key === 'ArrowLeft') {
    step(-1)
  }
}

/** The close button is the only control, so Tab has nowhere else to go while the view is open. */
function onOverlayKeydown(event) {
  if (event.key === 'Tab') {
    event.preventDefault()
    closeEl.value?.focus()
  }
}

function target(event) {
  const img = event.target instanceof Element ? event.target.closest(`img[${MARK}]`) : null
  return img && boundRoot.contains(img) ? img : null
}

function onClick(event) {
  const img = target(event)
  if (img) open(img)
}

function onKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const img = target(event)
  if (!img) return
  event.preventDefault()
  open(img)
}

function onLoad(event) {
  if (event.target instanceof HTMLImageElement) mark(event.target)
}

function unbind() {
  observer?.disconnect()
  observer = null
  if (boundRoot) {
    boundRoot.removeEventListener('click', onClick)
    boundRoot.removeEventListener('keydown', onKeydown)
    boundRoot.removeEventListener('load', onLoad, true)
  }
  boundRoot = null
}

watch(
  () => props.root,
  (root) => {
    unbind()
    if (!root) return
    boundRoot = root
    root.addEventListener('click', onClick)
    root.addEventListener('keydown', onKeydown)
    root.addEventListener('load', onLoad, true)
    observer = new MutationObserver(markAll)
    observer.observe(root, { childList: true, subtree: true })
    markAll()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  unbind()
  if (current.value) close()
})
</script>

<style lang="scss" scoped>
// Dark in both themes: a photograph is judged against black, not the page, so there is no
// `body--dark` variant to write and no `.w-dark-surface` twin to keep.
.image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 7000;
  display: flex;
  align-items: center;
  justify-content: center;
  // -> Room under the picture for the caption, so the two never overlap
  padding: 16px 16px 48px;
  background: rgb(0 0 0 / 0.88);
  cursor: zoom-out;
  outline: none;
}

.image-lightbox-img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 2px;
  user-select: none;

  // -> The small copy the page already has, stretched to the viewport until the original lands
  &.is-preview {
    width: 100%;
    height: 100%;
    opacity: 0.6;
  }
}

.image-lightbox-spinner {
  position: absolute;
  top: 50%;
  left: 50%;
  margin: -18px 0 0 -18px;
  color: #fff;
}

.image-lightbox-close {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  color: #fff;
  background: rgb(255 255 255 / 0.12);
  cursor: pointer;

  &:hover {
    background: rgb(255 255 255 / 0.24);
  }
  &:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }
}

.image-lightbox-caption {
  position: absolute;
  right: 64px;
  bottom: 12px;
  left: 64px;
  margin: 0;
  color: #e8e8e8;
  font-size: 0.9rem;
  text-align: center;
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.8);
}

@media (prefers-reduced-motion: no-preference) {
  .image-lightbox-enter-active,
  .image-lightbox-leave-active {
    transition: opacity 0.15s ease;
  }
  .image-lightbox-enter-from,
  .image-lightbox-leave-to {
    opacity: 0;
  }
}
</style>
