/**
 * Fork: the scaled-down copies an image is delivered in -- the contract every part of image delivery
 * shares (the job that makes them, `/_files/` that serves them, the render step that offers them in a
 * `srcset`), so that all three name the same widths.
 *
 * The widths climb from `VARIANT_BASE_WIDTH` by a factor of `VARIANT_STEP`, as far as the image goes
 * and no further: every step narrower than the image itself, and nothing at or above it -- there the
 * original is the better file. There is no upper cap, so a 6000 px photograph gets a 5468 px copy
 * too. Only these widths are ever made or served, which is also what keeps `?w=` from being a way to
 * make the server encode, and keep, an image at every width anybody cares to ask for.
 *
 * A copy is addressed as its original's URL with the width as a query: `/_files/<path>?w=<width>`.
 */

/** The narrowest copy, in pixels. */
export const VARIANT_BASE_WIDTH = 320

/** How much wider each copy is than the one before it. */
export const VARIANT_STEP = 1.5

/** The query parameter a copy's width is asked for by. */
export const VARIANT_WIDTH_PARAM = 'w'

/**
 * Every width an image `originalWidth` pixels wide has a copy at, narrowest first. Empty for an image
 * no wider than the narrowest copy, or one whose width is not known.
 */
export function variantWidths(originalWidth: number | null | undefined): number[] {
  if (!originalWidth || !Number.isFinite(originalWidth) || originalWidth <= 0) {
    return []
  }
  const widths: number[] = []
  // -> Each step computed from the base rather than from the rounded step before it, so rounding
  //    never accumulates and every caller lands on the same integers
  for (let n = 0; ; n++) {
    const width = Math.round(VARIANT_BASE_WIDTH * VARIANT_STEP ** n)
    if (width >= originalWidth) {
      return widths
    }
    widths.push(width)
  }
}

/** Whether `width` is one of the copies an image `originalWidth` pixels wide has. */
export function isVariantWidth(width: number, originalWidth: number | null | undefined): boolean {
  return variantWidths(originalWidth).includes(width)
}

/** The URL of an image's copy at `width`, from the URL of the original (`/_files/...`). */
export function variantUrl(originalUrl: string, width: number): string {
  return `${originalUrl}${originalUrl.includes('?') ? '&' : '?'}${VARIANT_WIDTH_PARAM}=${width}`
}
