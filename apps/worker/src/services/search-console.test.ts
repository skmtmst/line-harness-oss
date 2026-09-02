import { afterEach, describe, expect, test, vi } from 'vitest';
import { getSearchConsolePerformance } from './search-console.js';

afterEach(() => vi.unstubAllGlobals());

describe('getSearchConsolePerformance', () => {
  test('期間比較・日別・検索語・ページ・端末をread-only APIから取得する', async () => {
    const responses = [
      { rows: [{ clicks: 120, impressions: 2400, ctr: 0.05, position: 7.2 }] },
      { rows: [{ clicks: 100, impressions: 2000, ctr: 0.05, position: 8.1 }] },
      { rows: [{ keys: ['2026-08-13'], clicks: 8, impressions: 180, ctr: 0.044, position: 7.4 }] },
      { rows: [{ keys: ['鹿肉 ドッグフード'], clicks: 30, impressions: 500, ctr: 0.06, position: 4.2 }] },
      { rows: [{ keys: ['https://nen-petfood.com/column/1'], clicks: 22, impressions: 440, ctr: 0.05, position: 6.3 }] },
      { rows: [{ keys: ['MOBILE'], clicks: 80, impressions: 1600, ctr: 0.05, position: 7 }] },
    ];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return Response.json(responses.shift());
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getSearchConsolePerformance({
      accessToken: 'token',
      siteUrl: 'sc-domain:nen-petfood.com',
      rangeDays: 28,
      now: new Date('2026-08-14T12:00:00Z'),
    });

    expect(result).toMatchObject({
      startDate: '2026-07-17',
      endDate: '2026-08-13',
      summary: { clicks: 120, impressions: 2400, ctr: 0.05, position: 7.2 },
      previousSummary: { clicks: 100 },
      queries: [{ key: '鹿肉 ドッグフード' }],
      devices: [{ key: 'MOBILE' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('sc-domain%3Anen-petfood.com/searchAnalytics/query');
  });

  test('Google APIのエラー本文をログへ持ち込まずステータスだけ保持する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(500), { status: 403 })));
    await expect(getSearchConsolePerformance({
      accessToken: 'token',
      siteUrl: 'sc-domain:nen-petfood.com',
      rangeDays: 7,
      now: new Date('2026-08-14T12:00:00Z'),
    })).rejects.toThrow(/^search_console_query_failed:403$/);
  });
});
