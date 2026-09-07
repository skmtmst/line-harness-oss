import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

// @ts-expect-error 画面確認スクリプトは素のJSで型定義を持たない。
import { buildPixelDiffReport, classifyHeightReason, compareRgba, compareScreen, ROOT, thresholdMarkdown } from './pixel-diff.mjs'
// @ts-expect-error 画面確認スクリプトは素のJSで型定義を持たない。
import { SCREENS } from './screens.mjs'

function image(width: number, height: number, pixels: number[][]) {
  return { width, height, data: Buffer.from(pixels.flat()) }
}

const WHITE = [255, 255, 255, 255]
const BLACK = [0, 0, 0, 255]

function writePng(path: string, rgba: number[], width = 2, height = 2) {
  const png = new PNG({ width, height })
  png.data = Buffer.from(Array.from({ length: width * height }, () => rgba).flat())
  writeFileSync(path, PNG.sync.write(png))
}

describe('Pencil設計との画素比較', () => {
  it('同じ画像は差分0%', () => {
    const source = image(2, 2, [WHITE, WHITE, WHITE, WHITE])
    const result = compareRgba(source, source)
    expect(result.pixelDiffPercent).toBe(0)
    expect(result.mismatchedPixels).toBe(0)
    expect(result.dominantRegion).toBe('差なし')
  })

  it('1/4画素の色違いを25%として位置も出す', () => {
    const design = image(2, 2, [WHITE, WHITE, WHITE, WHITE])
    const implementation = image(2, 2, [BLACK, WHITE, WHITE, WHITE])
    const result = compareRgba(design, implementation)
    expect(result.pixelDiffPercent).toBe(25)
    expect(result.boundingBox).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
    expect(result.dominantRegion).toBe('上部・左')
  })

  it('高さが違うときは上端から短い側を比べ、高さ差を別に出す', () => {
    const design = image(2, 3, [WHITE, WHITE, WHITE, WHITE, WHITE, WHITE])
    const implementation = image(2, 2, [WHITE, WHITE, WHITE, WHITE])
    const result = compareRgba(design, implementation)
    expect(result.comparedHeight).toBe(2)
    expect(result.heightDifferencePx).toBe(-1)
    expect(result.pixelDiffPercent).toBe(0)
  })

  it('画素差がなくても高さ差が24pxを超えれば注意対象にする', () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-diff-'))
    try {
      const designDir = join(root, 'docs/design-reference/test-v6')
      const implementationDir = join(root, 'docs/design-qa/test-v6')
      for (const dir of [designDir, implementationDir]) mkdirSync(dir, { recursive: true })
      writePng(join(designDir, 'node.png'), WHITE, 2, 2)
      writePng(join(implementationDir, 'node-1920.png'), WHITE, 2, 27)

      const result = compareScreen({
        feature: 1, node: 'node', name: '高さ超過', dir: 'test-v6', verdict: 'match',
      }, { root, writeDiffImages: false })
      expect(result.pixelDiffPercent).toBe(0)
      expect(result.heightDifferencePx).toBe(25)
      expect(result.pixelAboveThreshold).toBe(false)
      expect(result.heightAboveThreshold).toBe(true)
      expect(result.aboveThreshold).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('旧1080px固定撮影との差は実装差の注意対象にしない', () => {
    expect(classifyHeightReason({ height: 700 }, { height: 1080 })).toBe('撮影高')
    expect(classifyHeightReason(
      { height: 1136 },
      { height: 1080 },
      { screen: { mode: 'viewport', height: 1080 } },
    )).toBe('撮影高')
    expect(classifyHeightReason({ height: 1136 }, { height: 1080 })).toBe('実装')
    expect(classifyHeightReason({ height: 1080 }, { height: 1320 })).toBe('実装')
    expect(classifyHeightReason({ height: 1080 }, { height: 1100 })).toBeNull()
  })

  it('閾値超過だけをMarkdown一覧にする', () => {
    const markdown = thresholdMarkdown({
      comparedCount: 3,
      screenCount: 4,
      thresholdPercent: 3,
      heightDiffThresholdPx: 24,
      entries: [
        { feature: 1, node: 'over', pixelDiffPercent: 12.5, heightDifferencePx: 4, dominantRegion: '上部・右', pixelAboveThreshold: true, heightAboveThreshold: false, aboveThreshold: true, status: 'compared' },
        { feature: 2, node: 'tall', pixelDiffPercent: 0, heightDifferencePx: 25, dominantRegion: '差なし', pixelAboveThreshold: false, heightAboveThreshold: true, aboveThreshold: true, status: 'compared' },
        { feature: 1, node: 'ok', pixelDiffPercent: 2.9, heightDifferencePx: 0, dominantRegion: '中央・中央', aboveThreshold: false, status: 'compared' },
        { feature: 2, node: 'none', pixelDiffPercent: null, aboveThreshold: false, status: 'unavailable', reason: '設計画像なし' },
      ],
    })
    expect(markdown).toContain('`over` | 12.5000%')
    expect(markdown).toContain('`tall` | 0.0000% | +25px | 高さ差')
    expect(markdown).not.toContain('`ok`')
    expect(markdown).toContain('`none`（設計画像なし）')
  })

  it('生成済み台帳が全Nodeを持ち、比較済みの差分画像が存在する', () => {
    const report = JSON.parse(readFileSync(join(ROOT, 'docs/design-qa/v6-pixel-diff.json'), 'utf8'))
    expect(report.entries.map((entry: { node: string }) => entry.node)).toEqual(
      SCREENS.map((screen: { node: string }) => screen.node),
    )
    const missing = report.entries
      .filter((entry: { status: string }) => entry.status === 'compared')
      .filter((entry: { diffPath: string }) => !existsSync(join(ROOT, entry.diffPath)))
      .map((entry: { node: string }) => entry.node)
    expect(missing).toEqual([])
  })

  it('shotsの専用画像と無印の最新設計を幅別の旧画像より優先する', () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-diff-'))
    try {
      const designDir = join(root, 'docs/design-reference/test-v6')
      const implementationDir = join(root, 'docs/design-qa/test-v6')
      const snapshots = join(root, 'scripts/visual-qa/capture.spec.mjs-snapshots')
      for (const dir of [designDir, implementationDir, snapshots]) mkdirSync(dir, { recursive: true })
      writePng(join(designDir, 'node.png'), WHITE)
      writePng(join(designDir, 'node-1920.png'), BLACK)
      writePng(join(implementationDir, 'node-1920.png'), BLACK)
      writePng(join(snapshots, 'tags-csv-select-1920-darwin.png'), WHITE)

      const result = compareScreen({
        feature: 4, node: 'node', name: '専用状態', dir: 'test-v6', verdict: 'match', shots: 'tags-csv-select',
      }, { root, writeDiffImages: false })
      expect(result.pixelDiffPercent).toBe(0)
      expect(result.comparisons[0].designPath).toBe('docs/design-reference/test-v6/node.png')
      expect(result.comparisons[0].implementationPath).toContain('capture.spec.mjs-snapshots/tags-csv-select-1920-darwin.png')
      expect(result.implementationSource).toBe('snapshot')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('shotsの専用画像が無ければ追跡可能なdocs証拠画像を使う', () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-diff-'))
    try {
      const designDir = join(root, 'docs/design-reference/test-v6')
      const implementationDir = join(root, 'docs/design-qa/test-v6')
      for (const dir of [designDir, implementationDir]) mkdirSync(dir, { recursive: true })
      writePng(join(designDir, 'node.png'), WHITE)
      writePng(join(implementationDir, 'node-1920.png'), WHITE)

      const result = compareScreen({
        feature: 4, node: 'node', name: '専用状態', dir: 'test-v6', verdict: 'match', shots: 'tags-csv-select',
      }, { root, writeDiffImages: false })
      expect(result.pixelDiffPercent).toBe(0)
      expect(result.comparisons[0].implementationPath).toBe('docs/design-qa/test-v6/node-1920.png')
      expect(result.implementationSource).toBe('docs')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('実装画像が無い画面は既存結果を前回値として保持する', () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-diff-'))
    try {
      const designDir = join(root, 'docs/design-reference/test-v6')
      mkdirSync(designDir, { recursive: true })
      writePng(join(designDir, 'node.png'), WHITE)
      const previousEntry = {
        feature: 4, node: 'node', name: '保持対象', dir: 'test-v6',
        declaredVerdict: 'match', status: 'compared', reason: null,
        comparisons: [{ pixelDiffPercent: 1.25, diffPath: 'docs/design-qa/test-v6/node-diff-1920.png' }],
        pixelDiffPercent: 1.25, heightDifferencePx: 12, dominantRegion: '上部・左',
        implementationSource: 'docs', diffPath: 'docs/design-qa/test-v6/node-diff-1920.png',
        aboveThreshold: false,
      }
      const report = buildPixelDiffReport([
        { feature: 4, node: 'node', name: '保持対象', dir: 'test-v6', verdict: 'match' },
      ], {
        root,
        writeDiffImages: false,
        generatedAt: '2026-09-07T12:00:00.000Z',
        previousReport: { generatedAt: '2026-09-07T11:00:00.000Z', entries: [previousEntry] },
      })

      expect(report.comparedCount).toBe(1)
      expect(report.unavailableCount).toBe(0)
      expect(report.entries[0]).toEqual({
        ...previousEntry,
        retainedFrom: '2026-09-07T11:00:00.000Z',
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('範囲指定の外は保持し、比較できた範囲だけ更新する', () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-diff-'))
    try {
      const designDir = join(root, 'docs/design-reference/test-v6')
      const implementationDir = join(root, 'docs/design-qa/test-v6')
      for (const dir of [designDir, implementationDir]) mkdirSync(dir, { recursive: true })
      writePng(join(designDir, 'inside.png'), WHITE)
      writePng(join(implementationDir, 'inside-1920.png'), WHITE)
      const inside = { feature: 4, node: 'inside', name: '範囲内', dir: 'test-v6', verdict: 'match' }
      const outside = { feature: 5, node: 'outside', name: '範囲外', dir: 'test-v6', verdict: 'match' }
      const previousOutside = {
        ...outside,
        declaredVerdict: 'match', status: 'compared', reason: null, comparisons: [],
        pixelDiffPercent: 7.5, heightDifferencePx: 30, dominantRegion: '中央・中央',
        implementationSource: 'docs', diffPath: 'docs/design-qa/test-v6/outside-diff-1920.png',
        aboveThreshold: false,
      }
      const report = buildPixelDiffReport([inside], {
        allScreens: [inside, outside],
        root,
        writeDiffImages: false,
        previousReport: {
          generatedAt: '2026-09-07T11:30:00.000Z',
          entries: [previousOutside],
        },
      })

      expect(report.entries.map((entry: { node: string }) => entry.node)).toEqual(['inside', 'outside'])
      expect(report.entries[0].pixelDiffPercent).toBe(0)
      expect(report.entries[0]).not.toHaveProperty('retainedFrom')
      expect(report.heightAboveThresholdCount).toBe(1)
      expect(report.aboveThresholdCount).toBe(1)
      expect(report.entries[1]).toEqual({
        ...previousOutside,
        retainedFrom: '2026-09-07T11:30:00.000Z',
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
