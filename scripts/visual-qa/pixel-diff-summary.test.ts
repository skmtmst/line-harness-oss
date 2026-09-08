import { describe, expect, it } from 'vitest'

// @ts-expect-error 画面確認スクリプトは素のJSで型定義を持たない。
import { applyPixelDiffSummary, pixelDiffSummaryMismatches } from './pixel-diff-summary.mjs'

describe('画素比較明細の再集計', () => {
  it('旧集計が1でも新しい明細が0なら不整合を検出して全て0へ直す', () => {
    const stale = {
      thresholdPercent: 10,
      heightDiffThresholdPx: 24,
      screenCount: 1,
      comparedCount: 1,
      unavailableCount: 0,
      pixelAboveThresholdCount: 1,
      heightAboveThresholdCount: 1,
      aboveThresholdCount: 1,
      entries: [{
        status: 'compared', pixelDiffPercent: 1, heightDifferencePx: 0,
        pixelAboveThreshold: false, heightAboveThreshold: false, aboveThreshold: false,
      }],
    }

    expect(pixelDiffSummaryMismatches(stale)).toEqual([
      { key: 'pixelAboveThresholdCount', actual: 1, expected: 0 },
      { key: 'heightAboveThresholdCount', actual: 1, expected: 0 },
      { key: 'aboveThresholdCount', actual: 1, expected: 0 },
    ])
    expect(applyPixelDiffSummary(stale)).toMatchObject({
      screenCount: 1,
      comparedCount: 1,
      unavailableCount: 0,
      pixelAboveThresholdCount: 0,
      heightAboveThresholdCount: 0,
      aboveThresholdCount: 0,
    })
  })

  it('画素差のみ・高さ差のみ・両方・比較不能を重複なく数える', () => {
    const report = applyPixelDiffSummary({
      thresholdPercent: 10,
      heightDiffThresholdPx: 24,
      entries: [
        { status: 'compared', pixelAboveThreshold: true, heightAboveThreshold: false },
        { status: 'compared', pixelAboveThreshold: false, heightAboveThreshold: true },
        { status: 'compared', pixelAboveThreshold: true, heightAboveThreshold: true },
        { status: 'unavailable', pixelAboveThreshold: false, heightAboveThreshold: false },
      ],
    })

    expect(report).toMatchObject({
      screenCount: 4,
      comparedCount: 3,
      unavailableCount: 1,
      pixelAboveThresholdCount: 2,
      heightAboveThresholdCount: 2,
      aboveThresholdCount: 3,
    })
    expect(pixelDiffSummaryMismatches(report)).toEqual([])
  })

  it('古い明細に真偽値が無い場合も保存済みの閾値から再計算する', () => {
    const report = applyPixelDiffSummary({
      thresholdPercent: 3,
      heightDiffThresholdPx: 24,
      entries: [
        { status: 'compared', pixelDiffPercent: 3.1, heightDifferencePx: 0 },
        { status: 'compared', pixelDiffPercent: 0, heightDifferencePx: 25 },
      ],
    })

    expect(report).toMatchObject({
      pixelAboveThresholdCount: 1,
      heightAboveThresholdCount: 1,
      aboveThresholdCount: 2,
    })
  })
})
