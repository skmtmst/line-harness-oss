import { describe, expect, it } from 'vitest';
import { DAILY_METRICS, emptyDailyMetrics, fetchDailyMetrics } from './google-business-performance.js';
import type { FetchLike } from './google-business.js';

const LOCATION = 'accounts/111/locations/222';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fetchFrom(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): { fetch: FetchLike; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetch, calls };
}

function series(metric: string, values: Array<{ y: number; m: number; d: number; v?: number }>) {
  return {
    dailyMetric: metric,
    timeSeries: {
      datedValues: values.map(({ y, m, d, v }) => ({
        date: { year: y, month: m, day: d },
        ...(v === undefined ? {} : { value: String(v) }),
      })),
    },
  };
}

describe('fetchDailyMetrics', () => {
  it('10指標と期間をクエリに入れ、v1のlocations形式で呼ぶ', async () => {
    const { fetch, calls } = fetchFrom(() => jsonResponse({ multiDailyMetricTimeSeries: [] }));
    await fetchDailyMetrics({ fetch, accessToken: 'token' }, LOCATION, { startDate: '2026-07-01', endDate: '2026-09-27' });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.hostname).toBe('businessprofileperformance.googleapis.com');
    expect(url.pathname).toBe('/v1/locations/222:fetchMultiDailyMetricsTimeSeries');
    expect(url.searchParams.getAll('dailyMetrics')).toEqual(DAILY_METRICS.map(([metric]) => metric));
    expect(url.searchParams.get('daily_range.start_date.year')).toBe('2026');
    expect(url.searchParams.get('daily_range.start_date.month')).toBe('7');
    expect(url.searchParams.get('daily_range.start_date.day')).toBe('1');
    expect(url.searchParams.get('daily_range.end_date.day')).toBe('27');
    expect(calls[0].init?.method ?? 'GET').toBe('GET');
  });

  it('日付ごとに指標を束ね、値の無い日はnullのまま残す', async () => {
    const { fetch } = fetchFrom(() =>
      jsonResponse({
        multiDailyMetricTimeSeries: [
          {
            dailyMetricTimeSeries: [
              series('BUSINESS_IMPRESSIONS_DESKTOP_MAPS', [
                { y: 2026, m: 9, d: 1, v: 12 },
                { y: 2026, m: 9, d: 2, v: 0 },
              ]),
              series('CALL_CLICKS', [{ y: 2026, m: 9, d: 1, v: 3 }, { y: 2026, m: 9, d: 2 }]),
            ],
          },
          {
            dailyMetricTimeSeries: [series('BUSINESS_FOOD_MENU_CLICKS', [{ y: 2026, m: 9, d: 1, v: 7 }])],
          },
        ],
      }),
    );
    const days = await fetchDailyMetrics({ fetch, accessToken: 'token' }, LOCATION, { startDate: '2026-09-01', endDate: '2026-09-02' });

    expect(Object.keys(days).sort()).toEqual(['2026-09-01', '2026-09-02']);
    expect(days['2026-09-01'].impressionsDesktopMaps).toBe(12);
    expect(days['2026-09-01'].callClicks).toBe(3);
    expect(days['2026-09-01'].menuClicks).toBe(7);
    // 0件はnullではなく0として残る（「未取得」と区別する）
    expect(days['2026-09-02'].impressionsDesktopMaps).toBe(0);
    // 値が省略された日はnull
    expect(days['2026-09-02'].callClicks).toBeNull();
    // 応答に無い指標はnull
    expect(days['2026-09-01'].bookings).toBeNull();
    expect(days['2026-09-01'].foodOrders).toBeNull();
  });

  it('未知の指標名や日付欠けの行は無視する', async () => {
    const { fetch } = fetchFrom(() =>
      jsonResponse({
        multiDailyMetricTimeSeries: [
          {
            dailyMetricTimeSeries: [
              series('BUSINESS_CONVERSATIONS', [{ y: 2026, m: 9, d: 1, v: 5 }]),
              { dailyMetric: 'WEBSITE_CLICKS', timeSeries: { datedValues: [{ value: '9' }] } },
            ],
          },
        ],
      }),
    );
    const days = await fetchDailyMetrics({ fetch, accessToken: 'token' }, LOCATION, { startDate: '2026-09-01', endDate: '2026-09-01' });
    expect(days).toEqual({});
  });

  it('emptyDailyMetricsは全指標nullの行を返す', () => {
    const row = emptyDailyMetrics();
    expect(Object.keys(row)).toHaveLength(DAILY_METRICS.length);
    expect(Object.values(row).every((value) => value === null)).toBe(true);
  });
});
