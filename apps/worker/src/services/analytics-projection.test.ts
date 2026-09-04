import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rebuildAnalyticsDailyMetricsChunk: vi.fn(),
  recentAnalyticsProjectionRange: vi.fn(),
  ensureAnalyticsEventCoverage: vi.fn(),
  ensureAnalyticsUrlExposureCoverage: vi.fn(),
  getAnalyticsProjectionSchedulerCursor: vi.fn(),
  saveAnalyticsProjectionSchedulerCursor: vi.fn(),
}));

vi.mock('@line-crm/db', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@line-crm/db')),
  ...mocks,
}));

const { refreshRecentAnalyticsProjections, selectNextAnalyticsProjectionAccount } =
  await import('./analytics-projection.js');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recentAnalyticsProjectionRange.mockReturnValue({
    fromDate: '2026-08-20', toDate: '2026-08-26',
  });
  mocks.rebuildAnalyticsDailyMetricsChunk.mockResolvedValue({ status: 'matched', completed: true });
  mocks.ensureAnalyticsEventCoverage.mockResolvedValue(undefined);
  mocks.ensureAnalyticsUrlExposureCoverage.mockResolvedValue(undefined);
  mocks.getAnalyticsProjectionSchedulerCursor.mockResolvedValue('');
  mocks.saveAnalyticsProjectionSchedulerCursor.mockResolvedValue(undefined);
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
    expect(result).toEqual({
      processed: 1, matched: 1, mismatched: 0, inProgress: 0, failed: 0,
    });
    expect(mocks.recentAnalyticsProjectionRange).toHaveBeenCalledWith(
      new Date('2026-08-26T00:00:00.000Z'), 'Asia/Tokyo', 31,
    );
    expect(mocks.rebuildAnalyticsDailyMetricsChunk).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ accountId: 'account-a', timeZone: 'Asia/Tokyo' }),
    );
    expect(mocks.ensureAnalyticsEventCoverage).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        lineAccountId: 'account-a',
        eventTypes: expect.arrayContaining(['friend_add', 'message_received']),
      }),
    );
    expect(mocks.ensureAnalyticsUrlExposureCoverage).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ lineAccountId: 'account-a' }),
    );
  });

  it('分割処理が未完了なら進行中として返す', async () => {
    mocks.rebuildAnalyticsDailyMetricsChunk.mockResolvedValueOnce({
      status: 'matched',
      completed: false,
    });
    const accounts = [
      { id: 'account-a', is_active: 1, timezone: 'Asia/Tokyo' },
    ] as never;

    const result = await refreshRecentAnalyticsProjections(
      {} as D1Database,
      accounts,
      new Date('2026-08-26T00:00:00.000Z'),
    );

    expect(result).toEqual({
      processed: 1, matched: 0, mismatched: 0, inProgress: 1, failed: 0,
    });
    expect(mocks.saveAnalyticsProjectionSchedulerCursor).toHaveBeenCalledWith(
      {}, 'account-a', '2026-08-26T00:00:00.000Z',
    );
  });

  it('1アカウントの失敗で残りを止めない', async () => {
    mocks.getAnalyticsProjectionSchedulerCursor
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('account-a');
    mocks.rebuildAnalyticsDailyMetricsChunk
      .mockRejectedValueOnce(new Error('db_busy'))
      .mockResolvedValueOnce({ status: 'mismatched', completed: true });
    const accounts = [
      { id: 'account-a', is_active: 1, timezone: 'Asia/Tokyo' },
      { id: 'account-b', is_active: 1, timezone: 'UTC' },
    ] as never;
    const first = await refreshRecentAnalyticsProjections(
      {} as D1Database,
      accounts,
      new Date('2026-08-26T00:00:00.000Z'),
    );
    const second = await refreshRecentAnalyticsProjections(
      {} as D1Database,
      accounts,
      new Date('2026-08-26T00:05:00.000Z'),
    );
    expect(first).toMatchObject({ processed: 1, failed: 1 });
    expect(second).toMatchObject({ processed: 1, mismatched: 1, failed: 0 });
    expect(mocks.saveAnalyticsProjectionSchedulerCursor).toHaveBeenNthCalledWith(
      1, {}, 'account-a', '2026-08-26T00:00:00.000Z',
    );
    expect(mocks.saveAnalyticsProjectionSchedulerCursor).toHaveBeenNthCalledWith(
      2, {}, 'account-b', '2026-08-26T00:05:00.000Z',
    );
  });

  it('ID順に巡回し、末尾の次は先頭へ戻る', () => {
    const accounts = [
      { id: 'account-c', is_active: 1 },
      { id: 'account-a', is_active: 1 },
      { id: 'account-b', is_active: 0 },
    ] as never;
    expect(selectNextAnalyticsProjectionAccount(accounts, '')?.id).toBe('account-a');
    expect(selectNextAnalyticsProjectionAccount(accounts, 'account-a')?.id).toBe('account-c');
    expect(selectNextAnalyticsProjectionAccount(accounts, 'account-c')?.id).toBe('account-a');
  });
});
