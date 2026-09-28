// 飲食店向け「Googleビジネス」第4段：パフォーマンス（Business Profile Performance API）。
// この層はDBを触らない。トークンと fetch を受け取り、日次集計値を型に直すだけ。
// 通信は第1段と同じ再試行付きの authorizedJson を使う（読み取りのみなので再試行してよい）。

import { authorizedJson, type RequestOptions } from './google-business.js';
import { v1LocationName } from './google-business-profile.js';

const PERFORMANCE_URL = 'https://businessprofileperformance.googleapis.com/v1';

// Google の DailyMetric 列挙値と rt_google_metrics_daily の列名の対応。
// fetchMultiDailyMetricsTimeSeries は1回の呼び出しで10指標まで＝ちょうど全部入る。
export const DAILY_METRICS = [
  ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'impressionsDesktopMaps'],
  ['BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'impressionsDesktopSearch'],
  ['BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'impressionsMobileMaps'],
  ['BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'impressionsMobileSearch'],
  ['BUSINESS_DIRECTION_REQUESTS', 'directionRequests'],
  ['CALL_CLICKS', 'callClicks'],
  ['WEBSITE_CLICKS', 'websiteClicks'],
  ['BUSINESS_FOOD_MENU_CLICKS', 'menuClicks'],
  ['BUSINESS_BOOKINGS', 'bookings'],
  ['BUSINESS_FOOD_ORDERS', 'foodOrders'],
] as const;

export type MetricKey = (typeof DAILY_METRICS)[number][1];

/** 1日ぶんの指標。未取得（Googleが値を返さない）は null。0件とは区別する。 */
export type DailyMetricValues = Record<MetricKey, number | null>;

export function emptyDailyMetrics(): DailyMetricValues {
  const row = {} as DailyMetricValues;
  for (const [, key] of DAILY_METRICS) row[key] = null;
  return row;
}

interface RawDate {
  year?: number;
  month?: number;
  day?: number;
}

interface RawDatedValue {
  date?: RawDate;
  value?: string | number;
}

interface RawDailyMetricTimeSeries {
  dailyMetric?: string;
  timeSeries?: { datedValues?: RawDatedValue[] };
}

interface RawMultiSeries {
  multiDailyMetricTimeSeries?: Array<{ dailyMetricTimeSeries?: RawDailyMetricTimeSeries[] }>;
}

function isoDateOf(raw: RawDate | undefined): string | null {
  if (!raw || !raw.year || !raw.month || !raw.day) return null;
  const mm = String(raw.month).padStart(2, '0');
  const dd = String(raw.day).padStart(2, '0');
  return `${raw.year}-${mm}-${dd}`;
}

function numberOf(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** YYYY-MM-DD を dailyRange.start_date.year 形式のクエリに分解する。 */
function appendDateParams(url: URL, prefix: 'daily_range.start_date' | 'daily_range.end_date', isoDate: string): void {
  const [year, month, day] = isoDate.split('-');
  url.searchParams.set(`${prefix}.year`, String(Number.parseInt(year, 10)));
  url.searchParams.set(`${prefix}.month`, String(Number.parseInt(month, 10)));
  url.searchParams.set(`${prefix}.day`, String(Number.parseInt(day, 10)));
}

/**
 * 期間内の日次指標をまとめて取得し、日付（YYYY-MM-DD）→ 指標値の表に正規化する。
 * Google が値を省略した日（未確定・対象機能なし等）は null のまま残る。
 */
export async function fetchDailyMetrics(
  options: RequestOptions,
  locationName: string,
  range: { startDate: string; endDate: string },
): Promise<Record<string, DailyMetricValues>> {
  const url = new URL(`${PERFORMANCE_URL}/${v1LocationName(locationName)}:fetchMultiDailyMetricsTimeSeries`);
  for (const [metric] of DAILY_METRICS) url.searchParams.append('dailyMetrics', metric);
  appendDateParams(url, 'daily_range.start_date', range.startDate);
  appendDateParams(url, 'daily_range.end_date', range.endDate);

  const raw = await authorizedJson<RawMultiSeries>(options, url.toString());
  const byMetricKey = new Map<string, MetricKey>(DAILY_METRICS.map(([metric, key]) => [metric, key]));
  const days: Record<string, DailyMetricValues> = {};

  for (const group of raw.multiDailyMetricTimeSeries ?? []) {
    for (const series of group.dailyMetricTimeSeries ?? []) {
      const key = series.dailyMetric ? byMetricKey.get(series.dailyMetric) : undefined;
      if (!key) continue;
      for (const dated of series.timeSeries?.datedValues ?? []) {
        const date = isoDateOf(dated.date);
        if (!date) continue;
        const row = (days[date] ??= emptyDailyMetrics());
        row[key] = numberOf(dated.value);
      }
    }
  }
  return days;
}
