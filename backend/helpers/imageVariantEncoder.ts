/**
 * Fork: the process that encodes an image's scaled-down copies (see `models/assetVariants.ts`).
 *
 * Run as a CHILD PROCESS, never imported. The parent forks at most `files.variants.concurrency` of
 * these and gives each one image at a time, which is the whole of how that many encodes are the most
 * that ever run at once. A process rather than a worker thread because a thread would not cap
 * anything: Sharp does its work on libvips's threads and on the process's libuv pool, both of which a
 * worker thread shares with the server. In here they are this process's own -- libvips held to one
 * thread, libuv's pool to one (`UV_THREADPOOL_SIZE`, set by the parent) -- so an encode costs one core
 * and never takes the threads the server reads files and answers DNS on. A crash in a decoder, or an
 * image that takes all the memory it is allowed, ends this process and not the wiki.
 *
 * Self-contained on purpose: no `WIKI` global, no models, nothing but Sharp. The parent has already
 * checked that Sharp is installed, read the bytes, and worked out the widths.
 */
import process from 'node:process'

/** What the parent asks for. */
export type EncodeRequest = {
  jobId: string
  data: Uint8Array
  /** The widths to make, from `variantWidths` on the image's stored width. */
  widths: number[]
  /** WebP quality for a lossy copy. */
  quality: number
  /** The original's size in bytes: a copy no smaller than this is not worth keeping. */
  originalSize: number
}

/** One width's outcome. `data` null means the original is the better file at this width. */
export type EncodedVariant = {
  width: number
  data: Uint8Array | null
}

export type EncodeReply =
  | {
      jobId: string
      ok: true
      variants: EncodedVariant[]
      lossless: boolean
    }
  | {
      jobId: string
      ok: false
      /** Permanent: these bytes will never encode (unreadable, over the pixel limit, animated). */
      permanent: boolean
      error: string
    }

/**
 * The most distinct colours a PNG sampled down to `PALETTE_SAMPLE` square may have and still count as
 * a screenshot or a diagram, which is copied losslessly so that its text and lines stay sharp.
 *
 * Sampled with the nearest-neighbour kernel, which invents no colour: what comes back is a subset of
 * the image's own. A photograph that size has tens of thousands; a screenshot, its anti-aliased text
 * included, a few hundred to a few thousand. Measured on this wiki's own: 638 and 5016 for two
 * screenshots, 33540 for a photograph kept as a PNG.
 */
const FEW_COLOURS = 8192
const PALETTE_SAMPLE = 256

let sharp: any = null

async function loadSharp(): Promise<any> {
  if (!sharp) {
    const specifier = 'sharp'
    ;({ default: sharp } = await import(specifier))
    // -> One libvips thread per encode, and nothing held in its operation cache between images: this
    //    process sees each image once
    sharp.concurrency(1)
    sharp.cache(false)
  }
  return sharp
}

/**
 * Whether a PNG is drawn rather than photographed: palette-based, or so few colours that it might
 * as well be. Only PNG is asked, since a JPEG or a lossy WebP has already given up the sharp edges
 * this is about keeping.
 */
async function isFewColours(input: Uint8Array, meta: any): Promise<boolean> {
  if (meta.format !== 'png') {
    return false
  }
  if (meta.isPalette) {
    return true
  }
  const { data } = await sharp(input)
    .resize(PALETTE_SAMPLE, PALETTE_SAMPLE, { fit: 'inside', kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const seen = new Set<number>()
  for (let i = 0; i < data.length; i += 4) {
    seen.add(data.readUInt32LE(i))
    if (seen.size > FEW_COLOURS) {
      return false
    }
  }
  return true
}

async function encode(request: EncodeRequest): Promise<EncodeReply> {
  const { jobId, data, widths, quality, originalSize } = request
  await loadSharp()

  let meta: any
  try {
    // -> The default pixel limit stays: it is what refuses a decompression bomb before decoding it
    meta = await sharp(data).metadata()
  } catch (err: any) {
    return { jobId, ok: false, permanent: true, error: `Unreadable image: ${err.message}` }
  }
  if ((meta.pages ?? 1) > 1) {
    return { jobId, ok: false, permanent: true, error: 'Animated image' }
  }
  const lossless = await isFewColours(data, meta)

  /*
    Decoded once, oriented, in sRGB and at the widest copy, then every copy is made from that: a
    49-megapixel PNG has no shrink-on-load, and decoding it again for each of eleven widths would be
    most of the work. Two resampling steps instead of one cost nothing visible at these ratios.
  */
  const sorted = [...widths].sort((a, b) => b - a)
  const base = await sharp(data)
    .rotate()
    .resize({ width: sorted[0], withoutEnlargement: true })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const raw = { width: base.info.width, height: base.info.height, channels: base.info.channels }

  const variants: EncodedVariant[] = []
  for (const width of sorted) {
    let pipeline = sharp(base.data, { raw })
    if (width < raw.width) {
      pipeline = pipeline.resize({ width, withoutEnlargement: true })
    }
    // -> Metadata is stripped by default, which is what is wanted: the orientation has been applied,
    //    the pixels are sRGB, and a reader has no use for the camera's EXIF
    const out: Buffer = await pipeline.webp(lossless ? { lossless: true } : { quality }).toBuffer()
    // -> A screenshot PNG can already be smaller than any WebP of it, and then the original is the copy
    variants.push({ width, data: out.length < originalSize ? out : null })
  }
  return { jobId, ok: true, variants: variants.reverse(), lossless }
}

process.on('message', async (request: EncodeRequest) => {
  let reply: EncodeReply
  try {
    reply = await encode(request)
  } catch (err: any) {
    // -> Sharp's own refusals (the pixel limit, a corrupt stream) are about the bytes, and will say
    //    the same next time; anything else may be this process, and is worth another try later
    const permanent = /pixel limit|unsupported image|corrupt|premature end|bad seek/i.test(
      err?.message ?? ''
    )
    reply = { jobId: request.jobId, ok: false, permanent, error: err?.message ?? String(err) }
  }
  process.send!(reply)
})

// -> The parent going away takes this process with it, rather than leaving it to idle forever
process.on('disconnect', () => process.exit(0))
