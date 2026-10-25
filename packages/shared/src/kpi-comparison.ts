/**
 * 数の比べ方の共通の型。ダッシュボードの数の帯と店の比較が同じ考えで色を決める。
 *
 * 向きは「増えると良い（high）」「減ると良い（low）」「どちらでもない（neutral）」。
 * 店の比較の `good: 'high' | 'low'` はこの型の一部として読める。
 */
export type KpiBetterDirection = 'high' | 'low' | 'neutral';

/**
 * 差の札の色の種類。差 0 は向きに関わらず `flat`（灰色の →）。
 * 向きが neutral の差は良し悪しを付けず `neutral`（灰色の ↑↓）。
 */
export type KpiChangeTone = 'good' | 'bad' | 'neutral' | 'flat';

export function kpiChangeTone(better: KpiBetterDirection, diff: number): KpiChangeTone {
  if (diff === 0) return 'flat';
  if (better === 'neutral') return 'neutral';
  return (better === 'high') === (diff > 0) ? 'good' : 'bad';
}

/**
 * 比べる基準。
 * - `same_weekday_last_week`：今日の数を先週の同じ曜日と比べる。
 * - `same_day_last_month`：今月の数を前の月の同じ日・同じ時刻までと比べる。
 */
export type DashboardComparisonBasis = 'same_weekday_last_week' | 'same_day_last_month';

/**
 * ダッシュボードで比べる数。対応が必要な受信・写真審査は「その時点の残り」を
 * 記録していないので比べない（ここに入れない）。
 */
export const DASHBOARD_COMPARISON_KEYS = [
  'todayBookings',
  'activeFriends',
  'deliveryFailures',
  'monthlySent',
  'monthlyBroadcasts',
] as const;

export type DashboardComparisonKey = typeof DASHBOARD_COMPARISON_KEYS[number];

/** 数ごとの良し悪しの向き。差の札の色はここだけで決める。 */
export const DASHBOARD_COMPARISON_BETTER: Record<DashboardComparisonKey, KpiBetterDirection> = {
  todayBookings: 'high',
  activeFriends: 'high',
  deliveryFailures: 'low',
  monthlySent: 'neutral',
  monthlyBroadcasts: 'neutral',
};

export interface DashboardComparison {
  /** 今の値。 */
  current: number;
  /** 比べる値。記録が無い時はこの形ごと null にする（0 で埋めない）。 */
  previous: number;
  basis: DashboardComparisonBasis;
  better: KpiBetterDirection;
  /** 今の値がいつ時点か（日本時間 +09:00）。 */
  asOf: string;
  /** 比べる値を数えた期間（日本時間 +09:00、終わりは含まない）。 */
  previousFrom: string;
  previousTo: string;
}

/**
 * 比べない理由。
 * - `no_previous_record`：比べる期間に記録が無い（記録を始める前・アカウントを作る前）。
 * - `source_failed`：数を取れなかった。
 */
export type DashboardComparisonSkipReason = 'no_previous_record' | 'source_failed';

export interface DashboardComparisons {
  /** 集計した時刻（日本時間 +09:00）。 */
  generatedAt: string;
  /** 比べられない数は null。画面は札を出さない。 */
  comparisons: Record<DashboardComparisonKey, DashboardComparison | null>;
  /** null にした数の理由。 */
  skipped: Partial<Record<DashboardComparisonKey, DashboardComparisonSkipReason>>;
}
