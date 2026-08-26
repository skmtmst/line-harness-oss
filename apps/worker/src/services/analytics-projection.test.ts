import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rebuildAnalyticsDailyMetrics: vi.fn(),
  recentAnalyticsProjectionRange: vi.fn(),
}));

vi.mock('@line-crm/db', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@line-crm/db')),
  ...mocks,
}));

const { refreshRecentAnalyticsProjections } = await import('./analytics-projection.js');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recentAnalyticsProjectionRange.mockReturnValue({
    fromDate: '2026-08-20', toDate: '2026-08-26',
  });
  mocks.rebuildAnalyticsDailyMetrics.mockResolvedValue({ status: 'matched' });
});

describe('分析の日別投影更新', () => {
  it('有効なアカウントだけを各タイムゾーンで更新する', async () => {
    const accounts = [
      { id: 'account-a', is_active: 1, timezone: 'Asia/Tokyo' },
      { id: 'account-b', is_active: 0, timezone: 'UTC' },
    ] as never;
    const result = await refreshRecentAnalyticsProjections(
      {} as D1Database,
      accounts,
      new Date('2026-08-26T00:00:00.000Z'),
    );
    expect(result).toEqual({ processed: 1, matched: 1, mismatched: 0, failed: 0 });
    expect(mocks.recentAnalyticsProjectionRange).toHaveBeenCalledWith(
      new Date('2026-08-26T00:00:00.000Z'), 'Asia/Tokyo', 7,
    );
    expect(mocks.rebuildAnalyticsDailyMetrics).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ accountId: 'account-a', timeZone: 'Asia/Tokyo' }),
    );
  });

  it('1アカウントの失敗で残りを止めない', async () => {
    mocks.rebuildAnalyticsDailyMetrics
      .mockRejectedValueOnce(new Error('db_busy'))
      .mockResolvedValueOnce({ status: 'mismatched' });
    const accounts = [
      { id: 'account-a', is_active: 1, timezone: 'Asia/Tokyo' },
      { id: 'account-b', is_active: 1, timezone: 'UTC' },
    ] as never;
    const result = await refreshRecentAnalyticsProjections(
      {} as D1Database,
      accounts,
      new Date('2026-08-26T00:00:00.000Z'),
    );
    expect(result).toEqual({ processed: 2, matched: 0, mismatched: 1, failed: 1 });
  });
});
