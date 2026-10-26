/** 運営ダッシュボード「最初の10分（新しいお店）」の作り物。数と割合だけで、お店の名や友だちは持たない。 */
const PERIOD_LABELS = { month: '今月', prev_month: '先月', year: '今年' }

export function opsFirstRunMock(period) {
  return {
    period,
    periodLabel: PERIOD_LABELS[period] ?? '今月',
    accounts: 24,
    stages: [
      { key: 'started', count: 24, percent: 100 },
      { key: 'style', count: 21, percent: 87.5 },
      { key: 'starter', count: 20, percent: 83.3 },
      { key: 'follow', count: 13, percent: 54.2 },
      { key: 'firstMessage', count: 11, percent: 45.8 },
    ],
    minutesToFirstMessage: { median: 9, p75: 17, reached: 11 },
    withinTenMinutesPercent: 25,
    allStepsDone: { count: 4, percent: 16.7 },
  }
}
