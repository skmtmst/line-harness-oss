/** Compare two supplied raster buffers; no board registry, expected layout or pass/fail gate. */
import pixelmatch from 'pixelmatch'

const REGION_ROWS = ['上部', '中央', '下部']
const REGION_COLUMNS = ['左', '中央', '右']

function rounded(value, digits = 4) {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function cropRgba(image, width, height) {
  const out = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * image.width * 4
    image.data.copy(out, y * width * 4, sourceStart, sourceStart + width * 4)
  }
  return out
}

function changedArea(diff, width, height) {
  const buckets = Array.from({ length: 9 }, () => 0)
  let left = width
  let top = height
  let right = -1
  let bottom = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (diff[(y * width + x) * 4 + 3] === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
      const row = Math.min(2, Math.floor((y * 3) / height))
      const column = Math.min(2, Math.floor((x * 3) / width))
      buckets[row * 3 + column] += 1
    }
  }

  if (right < 0) return { boundingBox: null, dominantRegion: '差なし' }
  const dominant = buckets.indexOf(Math.max(...buckets))
  return {
    boundingBox: { left, top, right, bottom },
    dominantRegion: `${REGION_ROWS[Math.floor(dominant / 3)]}・${REGION_COLUMNS[dominant % 3]}`,
  }
}

/** PNGへ書く前の純粋な比較。単体試験では小さなRGBA配列を直接渡す。 */
export function compareRgba(design, implementation, options = {}) {
  const width = Math.min(design.width, implementation.width)
  const height = Math.min(design.height, implementation.height)
  if (width < 1 || height < 1) throw new Error('比較できる画素がありません')

  const designData = cropRgba(design, width, height)
  const implementationData = cropRgba(implementation, width, height)
  const diffData = Buffer.alloc(width * height * 4)
  const mismatchedPixels = pixelmatch(
    designData,
    implementationData,
    diffData,
    width,
    height,
    {
      threshold: options.colorThreshold ?? 0.1,
      includeAA: options.includeAA ?? false,
      diffColor: [220, 38, 38],
      diffColorAlt: [37, 99, 235],
      diffMask: true,
    },
  )
  const area = changedArea(diffData, width, height)

  return {
    width,
    comparedHeight: height,
    designHeight: design.height,
    implementationHeight: implementation.height,
    heightDifferencePx: implementation.height - design.height,
    widthDifferencePx: implementation.width - design.width,
    mismatchedPixels,
    comparedPixels: width * height,
    pixelDiffPercent: rounded((mismatchedPixels / (width * height)) * 100),
    ...area,
    diffData,
  }
}
