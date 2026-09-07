/**
 * Pencil V6 の設計 PNG と Playwright の実装 PNG を、同じ横幅で画素比較する。
 *
 * 設計は `<node>.png`（多くは1920px）、または `<node>-<幅>.png`。
 * 実装は `<node>-<幅>.png`、状態画面は `<node>-normal-<幅>.png` を優先する。
 * 高さが違うときは上端をそろえ、短い側の高さだけを差分率の分母にする。
 * 高さの差そのものは `heightDifferencePx` に別記する。
 *
 *   node scripts/visual-qa/pixel-diff.mjs
 *   node scripts/visual-qa/pixel-diff.mjs --feature 7
 *   node scripts/visual-qa/pixel-diff.mjs --node J64xI
 *   node scripts/visual-qa/pixel-diff.mjs --fresh
 *   node scripts/visual-qa/pixel-diff.mjs --markdown
 */
import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

import { SCREENS } from './screens.mjs'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const DEFAULT_PIXEL_DIFF_THRESHOLD_PERCENT = 10
export const DEFAULT_HEIGHT_DIFF_THRESHOLD_PX = 24
export const LEGACY_CAPTURE_HEIGHT_PX = 1080
export const DEFAULT_REPORT = join(ROOT, 'docs', 'design-qa', 'v6-pixel-diff.json')

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

/**
 * 旧撮影は page/viewport を問わず1080pxを既定にしていた。
 * 設計高だけが違い実装画像がちょうど1080pxなら、UIの増減ではなく撮影高の差。
 */
export function classifyHeightReason(design, implementation, options = {}) {
  const threshold = options.heightDiffThresholdPx ?? DEFAULT_HEIGHT_DIFF_THRESHOLD_PX
  if (Math.abs(implementation.height - design.height) <= threshold) return null
  const screen = options.screen
  const shortDesignWithLegacyFloor = design.height < LEGACY_CAPTURE_HEIGHT_PX
    && implementation.height === LEGACY_CAPTURE_HEIGHT_PX
  const legacyViewport = screen?.mode === 'viewport'
    && implementation.height === (screen.height ?? LEGACY_CAPTURE_HEIGHT_PX)
    && implementation.height !== design.height
  return shortDesignWithLegacyFloor || legacyViewport
    ? '撮影高'
    : '実装'
}

function readPng(path) {
  return PNG.sync.read(readFileSync(path))
}

function normalizeSuffix(suffix) {
  return suffix.startsWith('-') ? suffix : `-${suffix}`
}

function designImages(screen, root = ROOT) {
  const dir = join(root, 'docs', 'design-reference', screen.dir)
  const generic = join(dir, `${screen.node}.png`)
  /*
    無印が現在の正本。幅別PNGは過去の書き出しが残ることがあり、zGZMAで
    古い設計を優先してしまった。無印が在るときは1920pxの現行設計だけを使う。
  */
  if (existsSync(generic)) return [{ width: 1920, path: generic, image: readPng(generic) }]

  const explicit = [1440, 1920]
    .map((width) => ({ width, path: join(dir, `${screen.node}-${width}.png`) }))
    .filter(({ path }) => existsSync(path))
  return explicit.sort((a, b) => a.width - b.width)
}

function implementationImage(screen, width, root = ROOT) {
  if (screen.shots) {
    const snapshots = join(root, 'scripts', 'visual-qa', 'capture.spec.mjs-snapshots')
    const exact = join(snapshots, `${screen.shots}-${width}-darwin.png`)
    if (existsSync(exact)) return exact
    if (existsSync(snapshots)) {
      const portable = readdirSync(snapshots)
        .find((name) => name.startsWith(`${screen.shots}-${width}-`) && name.endsWith('.png'))
      if (portable) return join(snapshots, portable)
    }
    const portableEvidence = join(root, 'docs', 'design-qa', screen.dir, `${screen.node}-${width}.png`)
    return existsSync(portableEvidence) ? portableEvidence : null
  }
  const dir = join(root, 'docs', 'design-qa', screen.dir)
  const named = [
    `${screen.node}-${width}.png`,
    `${screen.node}-normal-${width}.png`,
    ...(screen.states?.kinds ?? []).map((kind) => `${screen.node}-${kind}-${width}.png`),
    ...(screen.variants ?? []).map((variant) => `${screen.node}${normalizeSuffix(variant.suffix)}-${width}.png`),
  ]
  for (const name of named) {
    const path = join(dir, name)
    if (existsSync(path)) return path
  }

  if (!existsSync(dir)) return null
  const fallback = readdirSync(dir)
    .filter((name) => name.startsWith(`${screen.node}-`) && name.endsWith(`-${width}.png`) && !name.includes('-diff-'))
    .sort()[0]
  return fallback ? join(dir, fallback) : null
}

function relativePath(path, root = ROOT) {
  return relative(root, path).split('\\').join('/')
}

function implementationSource(path, root = ROOT) {
  const relativeImplementationPath = relativePath(path, root)
  return relativeImplementationPath.startsWith('scripts/visual-qa/capture.spec.mjs-snapshots/')
    ? 'snapshot'
    : 'docs'
}

export function compareScreen(screen, options = {}) {
  const root = options.root ?? ROOT
  const thresholdPercent = options.thresholdPercent ?? DEFAULT_PIXEL_DIFF_THRESHOLD_PERCENT
  const heightDiffThresholdPx = options.heightDiffThresholdPx ?? DEFAULT_HEIGHT_DIFF_THRESHOLD_PX
  const designs = designImages(screen, root)
  if (designs.length === 0) {
    return {
      feature: screen.feature, node: screen.node, name: screen.name, dir: screen.dir,
      declaredVerdict: screen.verdict ?? null,
      status: 'unavailable', reason: '設計画像なし', comparisons: [],
      pixelDiffPercent: null, pixelAboveThreshold: false,
      heightAboveThreshold: false, aboveThreshold: false,
    }
  }

  const comparisons = []
  const missingWidths = []
  for (const designFile of designs) {
    const implementationPath = implementationImage(screen, designFile.width, root)
    if (!implementationPath) {
      missingWidths.push(designFile.width)
      continue
    }
    const design = designFile.image ?? readPng(designFile.path)
    const implementation = readPng(implementationPath)
    const result = compareRgba(design, implementation, options)
    const heightReason = classifyHeightReason(design, implementation, { ...options, screen })
    const outputPath = join(root, 'docs', 'design-qa', screen.dir, `${screen.node}-diff-${designFile.width}.png`)
    if (options.writeDiffImages !== false) {
      mkdirSync(dirname(outputPath), { recursive: true })
      const png = new PNG({ width: result.width, height: result.comparedHeight })
      result.diffData.copy(png.data)
      writeFileSync(outputPath, PNG.sync.write(png, { colorType: 6 }))
    }
    const { diffData: _diffData, ...serializable } = result
    comparisons.push({
      ...serializable,
      heightReason,
      designPath: relativePath(designFile.path, root),
      implementationPath: relativePath(implementationPath, root),
      implementationSource: implementationSource(implementationPath, root),
      diffPath: relativePath(outputPath, root),
    })
  }

  if (comparisons.length === 0) {
    return {
      feature: screen.feature, node: screen.node, name: screen.name, dir: screen.dir,
      declaredVerdict: screen.verdict ?? null,
      status: 'unavailable', reason: `実装画像なし（${missingWidths.join('/')}px）`, comparisons: [],
      pixelDiffPercent: null, pixelAboveThreshold: false,
      heightAboveThreshold: false, aboveThreshold: false,
    }
  }

  const worstPixel = comparisons.reduce((a, b) => (b.pixelDiffPercent > a.pixelDiffPercent ? b : a))
  const worstHeight = comparisons.reduce((a, b) => (
    Math.abs(b.heightDifferencePx) > Math.abs(a.heightDifferencePx) ? b : a
  ))
  const pixelAboveThreshold = comparisons.some(
    (comparison) => comparison.pixelDiffPercent > thresholdPercent,
  )
  const heightAboveThreshold = comparisons.some(
    (comparison) => Math.abs(comparison.heightDifferencePx) > heightDiffThresholdPx
      && comparison.heightReason !== '撮影高',
  )
  return {
    feature: screen.feature, node: screen.node, name: screen.name, dir: screen.dir,
    declaredVerdict: screen.verdict ?? null,
    status: 'compared', reason: missingWidths.length ? `${missingWidths.join('/')}pxの実装画像なし` : null,
    comparisons,
    pixelDiffPercent: worstPixel.pixelDiffPercent,
    heightDifferencePx: worstHeight.heightDifferencePx,
    heightReason: worstHeight.heightReason,
    dominantRegion: worstPixel.dominantRegion,
    implementationSource: worstPixel.implementationSource,
    diffPath: worstPixel.diffPath,
    pixelAboveThreshold,
    heightAboveThreshold,
    aboveThreshold: pixelAboveThreshold || heightAboveThreshold,
  }
}

export function buildPixelDiffReport(screens = SCREENS, options = {}) {
  const thresholdPercent = options.thresholdPercent ?? DEFAULT_PIXEL_DIFF_THRESHOLD_PERCENT
  const heightDiffThresholdPx = options.heightDiffThresholdPx ?? DEFAULT_HEIGHT_DIFF_THRESHOLD_PX
  const allScreens = options.allScreens ?? screens
  const previousReport = options.previousReport ?? null
  const previousByNode = new Map((previousReport?.entries ?? []).map((entry) => [entry.node, entry]))
  const scopedNodes = new Set(screens.map((screen) => screen.node))
  const previousGeneratedAt = previousReport?.generatedAt ?? null
  const entries = allScreens.map((screen) => {
    const previous = previousByNode.get(screen.node)
    if (!scopedNodes.has(screen.node)) {
      if (previous && !options.fresh) return { ...previous, retainedFrom: previousGeneratedAt }
      return {
        feature: screen.feature, node: screen.node, name: screen.name, dir: screen.dir,
        declaredVerdict: screen.verdict ?? null,
        status: 'unavailable', reason: '指定範囲外（前回結果なし）', comparisons: [],
        pixelDiffPercent: null, pixelAboveThreshold: false,
        heightAboveThreshold: false, aboveThreshold: false,
      }
    }

    const compared = compareScreen(screen, { ...options, thresholdPercent })
    const implementationMissing = compared.status === 'unavailable'
      && compared.reason?.startsWith('実装画像なし')
    if (implementationMissing && previous && !options.fresh) {
      return { ...previous, retainedFrom: previousGeneratedAt }
    }
    return compared
  })
  const pixelAbove = (entry) => entry.pixelAboveThreshold
    ?? entry.pixelDiffPercent > thresholdPercent
  const heightAbove = (entry) => entry.heightAboveThreshold
    ?? Math.abs(entry.heightDifferencePx ?? 0) > heightDiffThresholdPx
  return {
    generatedFrom: 'scripts/visual-qa/screens.mjs',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    thresholdPercent,
    heightDiffThresholdPx,
    screenCount: allScreens.length,
    comparedCount: entries.filter((entry) => entry.status === 'compared').length,
    unavailableCount: entries.filter((entry) => entry.status === 'unavailable').length,
    pixelAboveThresholdCount: entries.filter(pixelAbove).length,
    heightAboveThresholdCount: entries.filter(heightAbove).length,
    aboveThresholdCount: entries.filter((entry) => pixelAbove(entry) || heightAbove(entry)).length,
    entries,
  }
}

export function thresholdMarkdown(report) {
  const heightDiffThresholdPx = report.heightDiffThresholdPx ?? DEFAULT_HEIGHT_DIFF_THRESHOLD_PX
  const pixelAbove = (entry) => entry.pixelAboveThreshold
    ?? entry.pixelDiffPercent > report.thresholdPercent
  const heightAbove = (entry) => entry.heightAboveThreshold
    ?? Math.abs(entry.heightDifferencePx ?? 0) > heightDiffThresholdPx
  const reason = (entry) => [
    pixelAbove(entry) ? '画素差' : null,
    heightAbove(entry) ? '高さ差' : null,
  ].filter(Boolean).join('・')
  const rows = report.entries
    .filter((entry) => pixelAbove(entry) || heightAbove(entry))
    .sort((a, b) => b.pixelDiffPercent - a.pixelDiffPercent)
  const unavailable = report.entries.filter((entry) => entry.status === 'unavailable')
  const lines = [
    `画素比較: ${report.comparedCount}/${report.screenCount}画面。注意条件（画素差 ${report.thresholdPercent}% 超、または高さ差 ${heightDiffThresholdPx}px 超）は ${rows.length}画面、比較不能は ${unavailable.length}画面です。`,
    '',
    '| 機能 | Node | 差分率 | 高さ差 | 注意理由 | 主な差の場所 |',
    '|---:|---|---:|---:|---|---|',
    ...rows.map((entry) => `| ${entry.feature} | \`${entry.node}\` | ${entry.pixelDiffPercent.toFixed(4)}% | ${entry.heightDifferencePx >= 0 ? '+' : ''}${entry.heightDifferencePx}px | ${reason(entry)} | ${entry.dominantRegion} |`),
  ]
  if (unavailable.length) {
    lines.push('', '比較不能:', unavailable.map((entry) => `\`${entry.node}\`（${entry.reason}）`).join('、'))
  }
  return lines.join('\n')
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : null
}

function runCli() {
  const feature = valueAfter('--feature')
  const node = valueAfter('--node')
  const thresholdValue = valueAfter('--threshold')
  const thresholdPercent = thresholdValue === null
    ? DEFAULT_PIXEL_DIFF_THRESHOLD_PERCENT
    : Number(thresholdValue)
  if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0 || thresholdPercent > 100) {
    throw new Error('--threshold は0〜100の数で指定してください')
  }
  const screens = SCREENS.filter((screen) => (
    (feature === null || screen.feature === Number(feature))
    && (node === null || screen.node === node)
  ))
  if (screens.length === 0) throw new Error('対象画面がありません')
  const fresh = process.argv.includes('--fresh')
  if (fresh && (feature !== null || node !== null)) {
    throw new Error('--fresh は全画面の完全再撮影時だけ使えます。--feature / --node とは併用できません')
  }

  const reportPath = resolve(valueAfter('--report') ?? DEFAULT_REPORT)
  const previousReport = !fresh && existsSync(reportPath)
    ? JSON.parse(readFileSync(reportPath, 'utf8'))
    : null
  const report = buildPixelDiffReport(screens, {
    allScreens: SCREENS,
    previousReport,
    fresh,
    thresholdPercent,
    writeDiffImages: !process.argv.includes('--no-diff-images'),
  })
  if (fresh) {
    const missing = report.entries.filter((entry) => (
      entry.status === 'unavailable' && entry.reason?.startsWith('実装画像なし')
    ))
    if (missing.length) {
      throw new Error(`--fresh を中止しました。実装画像が無い画面: ${missing.map((entry) => entry.node).join(', ')}`)
    }
  }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  if (process.argv.includes('--markdown')) console.log(thresholdMarkdown(report))
  else console.log(`画素比較 ${report.comparedCount}/${report.screenCount} ／ 注意 ${report.aboveThresholdCount}（画素差 ${report.pixelAboveThresholdCount}・高さ差 ${report.heightAboveThresholdCount}）／ 比較不能 ${report.unavailableCount}`)
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) runCli()
