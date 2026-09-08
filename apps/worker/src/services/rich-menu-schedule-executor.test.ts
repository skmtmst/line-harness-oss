import { beforeEach, describe, expect, test, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  RICH_MENU_SCHEDULE_MAX_ATTEMPTS: 5,
  RICH_MENU_SCHEDULE_STALE_MS: 10 * 60_000,
  getDueRichMenuSchedules: vi.fn(),
  getDueRichMenuScheduleRestores: vi.fn(),
  getStalePublishingSchedules: vi.fn(),
  getStaleRestoringSchedules: vi.fn(),
  reclaimStalePublishingSchedule: vi.fn(),
  reclaimStaleRestoringSchedule: vi.fn(),
  claimRichMenuSchedule: vi.fn(),
  claimRichMenuScheduleRestore: vi.fn(),
  recordRichMenuScheduleSuccess: vi.fn(),
  recordRichMenuScheduleRestoreSuccess: vi.fn(),
  recordRichMenuScheduleTransientFailure: vi.fn(),
  recordRichMenuScheduleRestoreTransientFailure: vi.fn(),
  recordRichMenuSchedulePermanentFailure: vi.fn(),
  classifyRichMenuScheduleError: vi.fn((error: unknown) => {
    const message = String(error instanceof Error ? error.message : error);
    if (/has no image|must be a published menu|not found|mismatch|account_inactive|account_archived|staff_inactive|staff_forbidden/i.test(message)) {
      return { code: message.slice(0, 120), retryable: false };
    }
    return { code: message.slice(0, 120), retryable: true };
  }),
  nextRichMenuScheduleRetryAt: vi.fn((_now: Date, _attempt: number) => '2026-09-10T01:01:00.000Z'),
  listRichMenuSchedulesByGroup: vi.fn(),
  cancelRichMenuSchedule: vi.fn(),
  toJstString: vi.fn((date: Date) => date.toISOString()),
}));

vi.mock('@line-crm/db', () => dbMocks);

import { processDueRichMenuSchedules } from './rich-menu-schedule-executor.js';

const db = {} as D1Database;

function schedule(overrides = {}) {
  return {
    id: 'schedule-1',
    group_id: 'menu-1',
    account_id: 'account-1',
    mode: 'scheduled',
    starts_at: '2026-09-10T01:00:00.000Z',
    ends_at: null,
    restore_group_id: null,
    definition_snapshot: JSON.stringify({ pages: [{ id: 'p1' }] }),
    status: 'scheduled',
    idempotency_key: 'key-1',
    requested_by_staff_id: 'staff-1',
    started_run_id: null,
    ended_run_id: null,
    last_error_code: null,
    attempt_count: 0,
    next_retry_at: null,
    created_at: '2026-09-06',
    updated_at: '2026-09-06',
    ...overrides,
  } as never;
}

function deps(overrides = {}) {
  return {
    getGroupWithPages: vi.fn().mockResolvedValue({ id: 'menu-1', account_id: 'account-1', status: 'draft' }),
    getLineAccount: vi.fn().mockResolvedValue({ id: 'account-1', channel_access_token: 'token', is_active: 1, archived_at: null }),
    getRequestingStaff: vi.fn().mockResolvedValue({ id: 'staff-1', role: 'owner', is_active: 1, access_level: 'full' }),
    isStaffAllowedForAccount: vi.fn().mockResolvedValue(true),
    publishSnapshot: vi.fn().mockResolvedValue(undefined),
    restoreToGroup: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const now = new Date('2026-09-10T01:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getDueRichMenuSchedules.mockResolvedValue([]);
  dbMocks.getDueRichMenuScheduleRestores.mockResolvedValue([]);
  dbMocks.getStalePublishingSchedules.mockResolvedValue([]);
  dbMocks.getStaleRestoringSchedules.mockResolvedValue([]);
});

describe('rich menu schedule executor', () => {
  test('時刻到来の予約を公開し completed にする', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    dbMocks.claimRichMenuSchedule.mockResolvedValue(true);
    const d = deps();

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.publishSnapshot).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordRichMenuScheduleSuccess).toHaveBeenCalledWith(
      db, 'schedule-1', 'account-1', expect.any(String), 'completed',
    );
    expect(result).toMatchObject({ processed: 1, succeeded: 1 });
  });

  test('同じ予約の二重取得は2本目を飛ばす', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    dbMocks.claimRichMenuSchedule.mockResolvedValue(false);
    const d = deps();

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.publishSnapshot).not.toHaveBeenCalled();
    expect(result).toMatchObject({ processed: 1, skipped: 1 });
  });

  test('一時失敗は次回時刻付きで scheduled に戻す', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    dbMocks.claimRichMenuSchedule.mockResolvedValue(true);
    const d = deps({ publishSnapshot: vi.fn().mockRejectedValue(new Error('fetch failed')) });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(dbMocks.recordRichMenuScheduleTransientFailure).toHaveBeenCalledWith(
      db, 'schedule-1', 'account-1', expect.any(String), '2026-09-10T01:01:00.000Z',
    );
    expect(result).toMatchObject({ retried: 1 });
  });

  test('上限回数の一時失敗と画像なしは failed に残す', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([
      schedule({ id: 's-retry-limit', attempt_count: 4 }),
      schedule({ id: 's-image', attempt_count: 0 }),
    ]);
    dbMocks.claimRichMenuSchedule.mockResolvedValue(true);
    const d = deps({
      getGroupWithPages: vi.fn().mockResolvedValue({ id: 'menu-1', account_id: 'account-1', status: 'draft' }),
      publishSnapshot: vi.fn().mockRejectedValue(new Error('fetch failed')),
    });
    // 2件目は画像なしの恒久失敗にする。
    d.publishSnapshot
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('page p1 has no image'));

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(dbMocks.recordRichMenuSchedulePermanentFailure).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ failed: 2 });
  });

  test('別アカウントの行は自分の公開に使わない', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule({ account_id: 'account-2' })]);
    dbMocks.claimRichMenuSchedule.mockResolvedValue(true);
    const d = deps({
      getGroupWithPages: vi.fn().mockResolvedValue({ id: 'menu-1', account_id: 'account-1', status: 'draft' }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.publishSnapshot).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuSchedulePermanentFailure).toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1 });
  });

  test('期間モードは published で置き、終了時に復元して completed にする', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([
      schedule({ id: 'period-1', mode: 'period', restore_group_id: 'restore-1' }),
    ]);
    dbMocks.getDueRichMenuScheduleRestores.mockResolvedValue([
      schedule({ id: 'period-1', mode: 'period', status: 'published', restore_group_id: 'restore-1', started_run_id: 'rms-period-1-1', ended_run_id: null }),
    ]);
    dbMocks.claimRichMenuSchedule.mockResolvedValue(true);
    dbMocks.claimRichMenuScheduleRestore.mockResolvedValue(true);
    const d = deps({
      getGroupWithPages: vi.fn().mockImplementation(async (_db: unknown, id: string) => {
        if (id === 'restore-1') return { id, account_id: 'account-1', status: 'published' };
        if (id === 'period-1' || id === 'menu-1') return { id: 'menu-1', account_id: 'account-1', status: 'draft' };
        return { id: 'menu-1', account_id: 'account-1', status: 'draft' };
      }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(dbMocks.recordRichMenuScheduleSuccess).toHaveBeenCalledWith(
      db, 'period-1', 'account-1', expect.any(String), 'published',
    );
    expect(d.restoreToGroup).toHaveBeenCalledWith('restore-1', expect.objectContaining({ id: 'period-1' }));
    expect(dbMocks.recordRichMenuScheduleRestoreSuccess).toHaveBeenCalled();
    expect(result).toMatchObject({ succeeded: 1, restored: 1 });
  });

  test('停止中の予約 (取消済み) は due に出ないため触らない', async () => {
    // getDue が空 = cron は cancelled/failed を拾わない。
    const result = await processDueRichMenuSchedules(db, deps(), { now });
    expect(result).toMatchObject({ processed: 0, succeeded: 0, restored: 0 });
  });

  test('停止中のLINEアカウントは公開せず failed に残す', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    dbMocks.claimRichMenuSchedule.mockResolvedValue(true);
    const d = deps({
      getLineAccount: vi.fn().mockResolvedValue({ id: 'account-1', channel_access_token: 'token', is_active: 0, archived_at: null }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.publishSnapshot).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuSchedulePermanentFailure).toHaveBeenCalledWith(
      db, 'schedule-1', 'account-1', expect.any(String), expect.stringContaining('account_inactive'),
    );
    expect(result).toMatchObject({ failed: 1 });
  });

  test('アーカイブ済みアカウントは公開せず failed に残す', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    dbMocks.claimRichMenuSchedule.mockResolvedValue(true);
    const d = deps({
      getLineAccount: vi.fn().mockResolvedValue({ id: 'account-1', channel_access_token: 'token', is_active: 1, archived_at: '2026-09-09T00:00:00+09:00' }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.publishSnapshot).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuSchedulePermanentFailure).toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1 });
  });

  test('権限を失った予約者は公開せず failed に残す (無効化)', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    dbMocks.claimRichMenuSchedule.mockResolvedValue(true);
    const d = deps({
      getRequestingStaff: vi.fn().mockResolvedValue({ id: 'staff-1', role: 'owner', is_active: 0, access_level: 'full' }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.publishSnapshot).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuSchedulePermanentFailure).toHaveBeenCalledWith(
      db, 'schedule-1', 'account-1', expect.any(String), expect.stringContaining('staff_inactive'),
    );
    expect(result).toMatchObject({ failed: 1 });
  });

  test('権限を失った予約者は公開せず failed に残す (降格・可視範囲喪失)', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([
      schedule({ id: 's-demoted' }),
      schedule({ id: 's-unscoped', requested_by_staff_id: 'staff-1' }),
    ]);
    dbMocks.claimRichMenuSchedule.mockResolvedValue(true);
    const d = deps({
      getRequestingStaff: vi.fn()
        .mockResolvedValueOnce({ id: 'staff-1', role: 'staff', is_active: 1, access_level: 'full' })
        .mockResolvedValueOnce({ id: 'staff-1', role: 'owner', is_active: 1, access_level: 'full' }),
      // 1件目は役割で弾かれて可視範囲確認まで進まないため、2件目の1回だけfalseを返す。
      isStaffAllowedForAccount: vi.fn().mockResolvedValue(false),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.publishSnapshot).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuSchedulePermanentFailure).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ failed: 2 });
  });

  test('復元先なし(null)は明示的default解除として restoreToGroup(null) を呼ぶ', async () => {
    dbMocks.getDueRichMenuScheduleRestores.mockResolvedValue([
      schedule({ id: 'period-clear', mode: 'period', status: 'published', restore_group_id: null, started_run_id: 'rms-x', ended_run_id: null }),
    ]);
    dbMocks.claimRichMenuScheduleRestore.mockResolvedValue(true);
    const d = deps({
      getGroupWithPages: vi.fn().mockResolvedValue({ id: 'menu-1', account_id: 'account-1', status: 'published' }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.restoreToGroup).toHaveBeenCalledWith(null, expect.objectContaining({ id: 'period-clear' }));
    expect(dbMocks.recordRichMenuScheduleRestoreSuccess).toHaveBeenCalled();
    expect(result).toMatchObject({ restored: 1 });
  });

  test('外部成功後DB記録前crashは二重公開せず成功記録だけ行う (失敗注入)', async () => {
    // 前回: 公開まで終わりgroupがpublished、started_run_idが残ったまま記録前に停止。
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([
      schedule({ id: 'crash-1', started_run_id: 'rms-crash-1-old', attempt_count: 1 }),
    ]);
    dbMocks.claimRichMenuSchedule.mockResolvedValue(true);
    const d = deps({
      getGroupWithPages: vi.fn().mockResolvedValue({ id: 'menu-1', account_id: 'account-1', status: 'published' }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.publishSnapshot).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuScheduleSuccess).toHaveBeenCalledWith(
      db, 'crash-1', 'account-1', expect.any(String), 'completed',
    );
    expect(result).toMatchObject({ succeeded: 1 });
  });

  test('復元の外部成功後crashは二重復元せず成功記録だけ行う', async () => {
    dbMocks.getDueRichMenuScheduleRestores.mockResolvedValue([
      schedule({ id: 'crash-restore', mode: 'period', status: 'published', restore_group_id: 'restore-1', started_run_id: 'rms-start', ended_run_id: 'rms-restore-old' }),
    ]);
    dbMocks.claimRichMenuScheduleRestore.mockResolvedValue(true);
    const d = deps({
      getGroupWithPages: vi.fn().mockImplementation(async (_db: unknown, id: string) => {
        if (id === 'restore-1') return { id, account_id: 'account-1', status: 'published' };
        return { id: 'menu-1', account_id: 'account-1', status: 'draft' };
      }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.restoreToGroup).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuScheduleRestoreSuccess).toHaveBeenCalled();
    expect(result).toMatchObject({ restored: 1 });
  });

  test('staleなpublishing/restoringは回収して再試行できる', async () => {
    dbMocks.getStalePublishingSchedules.mockResolvedValue([schedule({ id: 'stale-pub', status: 'publishing' })]);
    dbMocks.getStaleRestoringSchedules.mockResolvedValue([schedule({ id: 'stale-res', status: 'restoring' })]);
    dbMocks.reclaimStalePublishingSchedule.mockResolvedValue(true);
    dbMocks.reclaimStaleRestoringSchedule.mockResolvedValue(true);

    const result = await processDueRichMenuSchedules(db, deps(), { now });
    expect(dbMocks.reclaimStalePublishingSchedule).toHaveBeenCalledTimes(1);
    expect(dbMocks.reclaimStaleRestoringSchedule).toHaveBeenCalledTimes(1);
    expect(result.reclaimed).toBe(2);
  });

  test('復元対象が公開中でなくなったら failed に残す', async () => {
    dbMocks.getDueRichMenuScheduleRestores.mockResolvedValue([
      schedule({ id: 'restore-gone', mode: 'period', status: 'published', restore_group_id: 'restore-1', started_run_id: 'rms-x' }),
    ]);
    dbMocks.claimRichMenuScheduleRestore.mockResolvedValue(true);
    const d = deps({
      getGroupWithPages: vi.fn().mockImplementation(async (_db: unknown, id: string) => {
        if (id === 'restore-1') return { id, account_id: 'account-1', status: 'draft' };
        return { id: 'menu-1', account_id: 'account-1', status: 'published' };
      }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.restoreToGroup).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuSchedulePermanentFailure).toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1 });
  });
});
