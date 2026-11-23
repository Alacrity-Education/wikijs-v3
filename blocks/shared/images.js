/**
 * A page's pictures, for blocks that need them as the files they are.
 *
 * The server describes every `/_files/` picture of a stored page with a `srcset` of the scaled-down
 * copies it serves (`backend/helpers/renderImages.ts`), so the browser fetches the size the picture is
 * drawn at. That is right for a picture the page shows, and wrong for one a block reads: a copy is
 * narrower than the file, so its `naturalWidth` is not the width the file was drawn, annotated or
 * measured at, and its `currentSrc` is not the file. A block that takes a picture out of its body to
 * measure it, map something onto its pixels, or show it elsewhere (a lightbox, a zoom) hands it to
 * `useOriginalImage` first.
 *
 * The `srcset` is in the stored HTML, so the browser has read it before any block's code runs, and may
 * already have a copy on the way. Taking the attribute off is what changes the answer: removing
 * `srcset` or `sizes` is one of the mutations on which the browser selects the image source again, and
 * with neither left that is `src`, the original. The copy it had chosen stays the picture's current one
 * until the original has loaded, so read the size off `originalImageLoaded`, never off `complete` and
 * `naturalWidth` straight after the call.
 */

/** The attribute that marks a picture as one to be loaded as the file it is. */
export const ORIGINAL_IMAGE_ATTRIBUTE = 'data-original-image'

/** What the server marks a `width` and `height` with that are the file's own rather than the author's. */
const NATURAL_SIZE_ATTRIBUTE = 'data-natural-size'

/**
 * Make an `<img>` load its original file rather than a scaled-down copy, and say so on the element.
 *
 * Marks it `data-original-image`, which the page's own image handling (click-to-enlarge) leaves alone
 * (and which the server leaves undescribed on an `<img>` stored with it), and takes off what the server wrote
 * onto it: `srcset`, `sizes`, and a `width` and `height` marked `data-natural-size` -- so a `width` or
 * `height` still there afterwards is one the author asked for. Safe to call more than once and on a
 * picture that never had any of it (a page in the editor's preview, an image a block drew itself).
 *
 * @param {HTMLImageElement} img
 * @returns {string} The original's address, exactly as the `src` attribute has it
 */
export function useOriginalImage(img) {
  img.setAttribute(ORIGINAL_IMAGE_ATTRIBUTE, '')
  img.removeAttribute('srcset')
  img.removeAttribute('sizes')
  if (img.hasAttribute(NATURAL_SIZE_ATTRIBUTE)) {
    img.removeAttribute('width')
    img.removeAttribute('height')
    img.removeAttribute(NATURAL_SIZE_ATTRIBUTE)
  }
  return img.getAttribute('src') ?? ''
}

/**
 * Resolves once the original file is the picture's loaded image -- `naturalWidth` and `naturalHeight`
 * are then the file's own -- or once it has failed to load. Call after `useOriginalImage`.
 *
 * @param {HTMLImageElement} img
 * @returns {Promise<HTMLImageElement>}
 */
export function originalImageLoaded(img) {
  const isOriginal = () => img.complete && img.naturalWidth > 0 && img.currentSrc === img.src
  return new Promise((resolve) => {
    if (isOriginal()) {
      resolve(img)
      return
    }
    const settle = () => {
      if (isOriginal() || (img.complete && img.naturalWidth === 0)) {
        img.removeEventListener('load', settle)
        img.removeEventListener('error', settle)
        resolve(img)
      }
    }
    img.addEventListener('load', settle)
    img.addEventListener('error', settle)
  })
}
