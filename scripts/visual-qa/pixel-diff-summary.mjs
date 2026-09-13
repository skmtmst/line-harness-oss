const SUMMARY_KEYS = [
  'screenCount',
  'comparedCount',
  'unavailableCount',
  'pixelAboveThresholdCount',
  'heightAboveThresholdCount',
  'aboveThresholdCount',
]

function pixelAbove(entry, thresholdPercent) {
  return entry.pixelAboveThreshold ?? entry.pixelDiffPercent > thresholdPercent
}

function heightAbove(entry, heightDiffThresholdPx) {
  return entry.heightAboveThreshold
    ?? Math.abs(entry.heightDifferencePx ?? 0) > heightDiffThresholdPx
}

/** 画素比較の明細だけを入力に、上部の6集計値を一度に作る。 */
export function summarizePixelDiffEntries(entries, options = {}) {
  const thresholdPercent = options.thresholdPercent ?? 10
  const heightDiffThresholdPx = options.heightDiffThresholdPx ?? 24
  return {
    screenCount: entries.length,
    comparedCount: entries.filter((entry) => entry.status === 'compared').length,
    unavailableCount: entries.filter((entry) => entry.status === 'unavailable').length,
    pixelAboveThresholdCount: entries.filter((entry) => pixelAbove(entry, thresholdPercent)).length,
    heightAboveThresholdCount: entries.filter((entry) => heightAbove(entry, heightDiffThresholdPx)).length,
    aboveThresholdCount: entries.filter((entry) => (
      pixelAbove(entry, thresholdPercent) || heightAbove(entry, heightDiffThresholdPx)
    )).length,
  }
}

/** 保存済みの集計値と明細から再計算した値の食い違いを返す。 */
export function pixelDiffSummaryMismatches(report) {
  const expected = summarizePixelDiffEntries(report.entries ?? [], report)
  return SUMMARY_KEYS
    .filter((key) => report[key] !== expected[key])
    .map((key) => ({ key, actual: report[key], expected: expected[key] }))
}

/** 明細を唯一の入力として、古い集計値を全て置き換える。 */
export function applyPixelDiffSummary(report) {
  return {
    ...report,
    ...summarizePixelDiffEntries(report.entries ?? [], report),
  }
}
