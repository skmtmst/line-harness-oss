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
  getRichMenuScheduleById: vi.fn(),
  getSchedulePublications: vi.fn(),
  recordSchedulePublications: vi.fn(),
  recordRichMenuScheduleSuccess: vi.fn(),
  recordRichMenuScheduleRestoreSuccess: vi.fn(),
  recordRichMenuScheduleTransientFailure: vi.fn(),
  recordRichMenuScheduleRestoreTransientFailure: vi.fn(),
  recordRichMenuSchedulePermanentFailure: vi.fn(),
  acquirePublishLock: vi.fn(),
  releasePublishLock: vi.fn(),
  setPageRichMenuId: vi.fn(),
  markRichMenuGroupPublished: vi.fn(),
  markRichMenuGroupUnpublished: vi.fn(),
  clearRichMenuAssignmentsForGroup: vi.fn(),
  detectSnapshotPageDrift: vi.fn((_snapshot: unknown, _current: string[]): string | null => null),
  classifyRichMenuScheduleError: vi.fn((error: unknown) => {
    const message = String(error instanceof Error ? error.message : error);
    if (/has no image|must be a published menu|not found|mismatch|account_inactive|account_archived|staff_inactive|staff_forbidden|snapshot drift/i.test(message)) {
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

function schedule(overrides: Record<string, unknown> = {}): any {
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

function freshSchedule(overrides: Record<string, unknown> = {}): any {
  const base = schedule(overrides);
  return {
    ...base,
    status: 'publishing',
    started_run_id: 'rms-schedule-1-run',
    attempt_count: 1,
    ...overrides,
  } as never;
}

function deps(overrides = {}) {
  return {
    getGroupWithPages: vi.fn().mockResolvedValue({ id: 'menu-1', account_id: 'account-1', status: 'draft', pages: [{ id: 'p1' }] }),
    getLineAccount: vi.fn().mockResolvedValue({ id: 'account-1', channel_access_token: 'token', is_active: 1, archived_at: null }),
    getRequestingStaff: vi.fn().mockResolvedValue({ id: 'staff-1', role: 'owner', is_active: 1, access_level: 'full' }),
    isStaffAllowedForAccount: vi.fn().mockResolvedValue(true),
    publishSnapshot: vi.fn().mockResolvedValue([{ pageId: 'p1', newRichMenuId: 'line-p1' }]),
    restoreToGroup: vi.fn().mockResolvedValue([{ pageId: 'r1', newRichMenuId: 'line-r1' }]),
    deleteLineMenus: vi.fn().mockResolvedValue(undefined),
    unlinkIndividualLinks: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

const now = new Date('2026-09-10T01:00:00.000Z');

const claimedStartRuns = new Map<string, string>();
const claimedRestoreRuns = new Map<string, string>();

beforeEach(() => {
  vi.clearAllMocks();
  claimedStartRuns.clear();
  claimedRestoreRuns.clear();
  dbMocks.getDueRichMenuSchedules.mockResolvedValue([]);
  dbMocks.getDueRichMenuScheduleRestores.mockResolvedValue([]);
  dbMocks.getStalePublishingSchedules.mockResolvedValue([]);
  dbMocks.getStaleRestoringSchedules.mockResolvedValue([]);
  dbMocks.getSchedulePublications.mockResolvedValue([]);
  dbMocks.acquirePublishLock.mockResolvedValue(true);
  dbMocks.recordSchedulePublications.mockResolvedValue(undefined);
  dbMocks.setPageRichMenuId.mockResolvedValue(undefined);
  dbMocks.markRichMenuGroupPublished.mockResolvedValue(undefined);
  dbMocks.markRichMenuGroupUnpublished.mockResolvedValue(undefined);
  dbMocks.clearRichMenuAssignmentsForGroup.mockResolvedValue(undefined);
  dbMocks.recordRichMenuScheduleSuccess.mockResolvedValue(true);
  dbMocks.recordRichMenuScheduleRestoreSuccess.mockResolvedValue(true);
  dbMocks.recordRichMenuScheduleTransientFailure.mockResolvedValue(true);
  dbMocks.recordRichMenuScheduleRestoreTransientFailure.mockResolvedValue(true);
  dbMocks.recordRichMenuSchedulePermanentFailure.mockResolvedValue(true);
  dbMocks.detectSnapshotPageDrift.mockReturnValue(null);
  dbMocks.claimRichMenuSchedule.mockImplementation(async (_db: unknown, id: string, _account: string, runId: string) => {
    claimedStartRuns.set(id, runId);
    return true;
  });
  dbMocks.claimRichMenuScheduleRestore.mockImplementation(async (_db: unknown, id: string, _account: string, runId: string) => {
    claimedRestoreRuns.set(id, runId);
    return true;
  });
  // claimしたrunで読み直したらそのrunが残っている（fencingの正しい状態）。
  dbMocks.getRichMenuScheduleById.mockImplementation(async (_db: unknown, id: string) => {
    const runId = claimedStartRuns.get(id) ?? claimedRestoreRuns.get(id) ?? 'rms-test-run';
    const isRestore = claimedRestoreRuns.has(id);
    if (isRestore) {
      return { ...schedule({ id }), status: 'restoring', ended_run_id: runId, started_run_id: 'rms-start', attempt_count: 1 } as never;
    }
    return { ...schedule({ id }), status: 'publishing', started_run_id: runId, attempt_count: 1 } as never;
  });
});

describe('rich menu schedule executor', () => {
  test('時刻到来の予約を公開し completed にする', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
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
    const d = deps({ publishSnapshot: vi.fn().mockRejectedValue(new Error('fetch failed')) });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(dbMocks.recordRichMenuScheduleTransientFailure).toHaveBeenCalledWith(
      db, 'schedule-1', 'account-1', expect.any(String), expect.any(String), '2026-09-10T01:01:00.000Z',
    );
    expect(result).toMatchObject({ retried: 1 });
  });

  test('上限回数の一時失敗と画像なしは failed に残す', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([
      schedule({ id: 's-retry-limit', attempt_count: 4 }),
      schedule({ id: 's-image', attempt_count: 0 }),
    ]);
    dbMocks.getRichMenuScheduleById.mockImplementation(async (_db: unknown, id: string) => {
      if (id === 's-retry-limit') return { ...schedule({ id }), status: 'publishing', started_run_id: claimedStartRuns.get(id), attempt_count: 5 } as never;
      return { ...schedule({ id }), status: 'publishing', started_run_id: claimedStartRuns.get(id), attempt_count: 1 } as never;
    });
    const d = deps({
      getGroupWithPages: vi.fn().mockResolvedValue({ id: 'menu-1', account_id: 'account-1', status: 'draft', pages: [{ id: 'p1' }] }),
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
    const d = deps({
      getGroupWithPages: vi.fn().mockResolvedValue({ id: 'menu-1', account_id: 'account-1', status: 'draft', pages: [{ id: 'p1' }] }),
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
    let periodCallCount = 0;
    dbMocks.getRichMenuScheduleById.mockImplementation(async (_db: unknown, id: string) => {
      periodCallCount += 1;
      if (periodCallCount === 1) {
        return { ...schedule({ id, mode: 'period', restore_group_id: 'restore-1' }), status: 'publishing', started_run_id: claimedStartRuns.get(id), attempt_count: 1 } as never;
      }
      return { ...schedule({ id, mode: 'period', status: 'published', restore_group_id: 'restore-1', started_run_id: 'rms-start' }), status: 'restoring', ended_run_id: claimedRestoreRuns.get(id), attempt_count: 1 } as never;
    });
    const d = deps({
      getGroupWithPages: vi.fn().mockImplementation(async (_db: unknown, id: string) => {
        if (id === 'restore-1') return { id, account_id: 'account-1', status: 'published', pages: [{ id: 'r1' }] };
        if (id === 'period-1' || id === 'menu-1') return { id: 'menu-1', account_id: 'account-1', status: 'draft', pages: [{ id: 'p1' }] };
        return { id: 'menu-1', account_id: 'account-1', status: 'draft', pages: [{ id: 'p1' }] };
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
    dbMocks.getRichMenuScheduleById.mockImplementation(async (_db: unknown, id: string) => ({ ...schedule({ id }), status: 'publishing', started_run_id: claimedStartRuns.get(id), attempt_count: 1 } as never));
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
    dbMocks.getRichMenuScheduleById.mockImplementation(async () => ({ ...schedule({ id: 'period-clear', mode: 'period', status: 'published', restore_group_id: null, started_run_id: 'rms-x' }), status: 'restoring', ended_run_id: claimedRestoreRuns.get('period-clear'), attempt_count: 1 } as never));
    const d = deps({
      getGroupWithPages: vi.fn().mockResolvedValue({ id: 'menu-1', account_id: 'account-1', status: 'published', pages: [{ id: 'p1' }] }),
      restoreToGroup: vi.fn().mockResolvedValue([]),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.restoreToGroup).toHaveBeenCalledWith(null, expect.objectContaining({ id: 'period-clear' }));
    expect(d.unlinkIndividualLinks).toHaveBeenCalledWith(expect.objectContaining({ id: 'period-clear' }));
    expect(dbMocks.recordRichMenuScheduleRestoreSuccess).toHaveBeenCalled();
    expect(dbMocks.clearRichMenuAssignmentsForGroup).toHaveBeenCalledWith(db, 'menu-1');
    expect(result).toMatchObject({ restored: 1 });
  });

  test('journal済みはLINEを作り直さず成功記録だけ行う', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule({ id: 'crash-1' })]);
    dbMocks.getRichMenuScheduleById.mockImplementation(async () => ({ ...schedule({ id: 'crash-1' }), status: 'publishing', started_run_id: claimedStartRuns.get('crash-1'), attempt_count: 1 } as never));
    dbMocks.getSchedulePublications.mockResolvedValue([
      { schedule_id: 'crash-1', kind: 'publish', page_id: 'p1', line_richmenu_id: 'line-p1', run_id: 'old-run', created_at: '2026-09-10' },
    ]);
    const d = deps({
      getGroupWithPages: vi.fn().mockResolvedValue({ id: 'menu-1', account_id: 'account-1', status: 'draft', pages: [{ id: 'p1' }] }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.publishSnapshot).not.toHaveBeenCalled();
    expect(dbMocks.setPageRichMenuId).toHaveBeenCalledWith(db, 'p1', 'line-p1');
    expect(dbMocks.recordRichMenuScheduleSuccess).toHaveBeenCalled();
    expect(result).toMatchObject({ succeeded: 1 });
  });

  test('claim直後・LINE前停止のstale再開は必ず公開を試みる（0回で完了にしない）', async () => {
    // stale回収でscheduledへ戻った行。journalなし・groupは未公開のまま。
    // group.statusだけでの完成判定をやめたため、必ずpublishを1回呼ぶ。
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule({ id: 'stale-crash' })]);
    dbMocks.getRichMenuScheduleById.mockImplementation(async () => ({ ...schedule({ id: 'stale-crash' }), status: 'publishing', started_run_id: claimedStartRuns.get('stale-crash'), attempt_count: 1 } as never));
    dbMocks.getSchedulePublications.mockResolvedValue([]);
    const d = deps({
      getGroupWithPages: vi.fn().mockResolvedValue({ id: 'menu-1', account_id: 'account-1', status: 'draft', pages: [{ id: 'p1' }] }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.publishSnapshot).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordRichMenuScheduleSuccess).toHaveBeenCalled();
    expect(result).toMatchObject({ succeeded: 1 });
  });

  test('stale run Aの書き込みはfencingで無効化し skipped になる', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule({ id: 'fence-1' })]);
    dbMocks.getRichMenuScheduleById.mockImplementation(async () => ({ ...schedule({ id: 'fence-1' }), status: 'publishing', started_run_id: claimedStartRuns.get('fence-1'), attempt_count: 1 } as never));
    dbMocks.recordRichMenuScheduleSuccess.mockResolvedValue(false);
    const d = deps();

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.publishSnapshot).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ skipped: 1, succeeded: 0 });
  });

  test('復元のjournal済みは二重復元せず成功記録だけ行う', async () => {
    dbMocks.getDueRichMenuScheduleRestores.mockResolvedValue([
      schedule({ id: 'crash-restore', mode: 'period', status: 'published', restore_group_id: 'restore-1', started_run_id: 'rms-start', ended_run_id: 'rms-restore-old' }),
    ]);
    dbMocks.getRichMenuScheduleById.mockImplementation(async () => ({ ...schedule({ id: 'crash-restore', mode: 'period', restore_group_id: 'restore-1', started_run_id: 'rms-start' }), status: 'restoring', ended_run_id: claimedRestoreRuns.get('crash-restore'), attempt_count: 1 } as never));
    dbMocks.getSchedulePublications.mockResolvedValue([
      { schedule_id: 'crash-restore', kind: 'restore', page_id: 'r1', line_richmenu_id: 'line-r1', run_id: 'old-restore', created_at: '2026-09-10' },
    ]);
    const d = deps({
      getGroupWithPages: vi.fn().mockImplementation(async (_db: unknown, id: string) => {
        if (id === 'restore-1') return { id, account_id: 'account-1', status: 'published', pages: [{ id: 'r1' }] };
        return { id: 'menu-1', account_id: 'account-1', status: 'draft', pages: [{ id: 'p1' }] };
      }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.restoreToGroup).not.toHaveBeenCalled();
    expect(d.unlinkIndividualLinks).toHaveBeenCalledWith(expect.objectContaining({ id: 'crash-restore' }));
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
    dbMocks.getRichMenuScheduleById.mockImplementation(async () => ({ ...schedule({ id: 'restore-gone', mode: 'period', restore_group_id: 'restore-1', started_run_id: 'rms-x' }), status: 'restoring', ended_run_id: claimedRestoreRuns.get('restore-gone'), attempt_count: 1 } as never));
    const d = deps({
      getGroupWithPages: vi.fn().mockImplementation(async (_db: unknown, id: string) => {
        if (id === 'restore-1') return { id, account_id: 'account-1', status: 'draft', pages: [{ id: 'r1' }] };
        return { id: 'menu-1', account_id: 'account-1', status: 'published', pages: [{ id: 'p1' }] };
      }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.restoreToGroup).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuSchedulePermanentFailure).toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1 });
  });

  test('予約後のページ削除はdriftで failed に残し公開しない', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule({ id: 'drift-1' })]);
    dbMocks.getRichMenuScheduleById.mockImplementation(async () => ({ ...schedule({ id: 'drift-1' }), status: 'publishing', started_run_id: claimedStartRuns.get('drift-1'), attempt_count: 1 } as never));
    dbMocks.detectSnapshotPageDrift.mockReturnValue('snapshot drift: pages deleted after reservation (p1)');
    const d = deps({
      getGroupWithPages: vi.fn().mockResolvedValue({ id: 'menu-1', account_id: 'account-1', status: 'draft', pages: [] }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.publishSnapshot).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuSchedulePermanentFailure).toHaveBeenCalledWith(
      db, 'drift-1', 'account-1', expect.any(String), expect.stringContaining('snapshot drift'),
    );
    expect(result).toMatchObject({ failed: 1 });
  });

  test('予約後の下書き編集（内容変更）はsnapshot正本で公開する', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule({ id: 'edited-1' })]);
    dbMocks.detectSnapshotPageDrift.mockReturnValue(null);
    const d = deps({
      // 現在の下書きは編集済みだがpage idは同じ。snapshotの内容で出す。
      getGroupWithPages: vi.fn().mockResolvedValue({ id: 'menu-1', account_id: 'account-1', status: 'draft', pages: [{ id: 'p1', name: 'edited' }] }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.publishSnapshot).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ succeeded: 1 });
  });

  test('journal保存前のD1失敗は作ったLINEを消してから一時失敗に戻す', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule({ id: 'comp-1' })]);
    dbMocks.recordSchedulePublications.mockRejectedValueOnce(new Error('D1 unavailable'));
    const d = deps();
    const deleteSpy = d.deleteLineMenus as ReturnType<typeof vi.fn>;

    const result = await processDueRichMenuSchedules(db, d, { now });
    // LINEは1回だけ呼び、journal失敗後は作った分を消して再試行にする。
    expect(d.publishSnapshot).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'comp-1' }),
      [{ pageId: 'p1', newRichMenuId: 'line-p1' }],
    );
    expect(result).toMatchObject({ retried: 1, succeeded: 0 });
  });

  test('journal再開もlockを迂回しない（取れなければ再試行）', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule({ id: 'journal-lock' })]);
    dbMocks.getSchedulePublications.mockResolvedValue([
      { schedule_id: 'journal-lock', kind: 'publish', page_id: 'p1', line_richmenu_id: 'line-p1', run_id: 'old-run', created_at: '2026-09-10' },
    ]);
    dbMocks.acquirePublishLock.mockResolvedValue(false);
    const d = deps();

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.publishSnapshot).not.toHaveBeenCalled();
    expect(dbMocks.setPageRichMenuId).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuScheduleTransientFailure).toHaveBeenCalled();
    expect(result).toMatchObject({ retried: 1 });
  });

  test('group lock取得失敗は一時失敗で再試行する', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule({ id: 'locked-1' })]);
    dbMocks.getRichMenuScheduleById.mockImplementation(async () => ({ ...(schedule({ id: 'locked-1' }) as unknown as Record<string, unknown>), status: 'publishing', started_run_id: claimedStartRuns.get('locked-1'), attempt_count: 1 } as never));
    dbMocks.acquirePublishLock.mockResolvedValue(false);
    const d = deps();

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.publishSnapshot).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuScheduleTransientFailure).toHaveBeenCalled();
    expect(result).toMatchObject({ retried: 1 });
  });

  test('復元成功時は期限切れメニューの個別割当を外す', async () => {
    dbMocks.getDueRichMenuScheduleRestores.mockResolvedValue([
      schedule({ id: 'restore-assign', mode: 'period', status: 'published', restore_group_id: 'restore-1', started_run_id: 'rms-x' }),
    ]);
    dbMocks.getRichMenuScheduleById.mockImplementation(async () => ({ ...(schedule({ id: 'restore-assign', mode: 'period', restore_group_id: 'restore-1', started_run_id: 'rms-x' }) as unknown as Record<string, unknown>), status: 'restoring', ended_run_id: claimedRestoreRuns.get('restore-assign'), attempt_count: 1 } as never));
    const d = deps({
      getGroupWithPages: vi.fn().mockImplementation(async (_db: unknown, id: string) => {
        if (id === 'restore-1') return { id, account_id: 'account-1', status: 'published', pages: [{ id: 'r1' }] };
        return { id: 'menu-1', account_id: 'account-1', status: 'published', pages: [{ id: 'p1' }] };
      }),
      restoreToGroup: vi.fn().mockResolvedValue([{ pageId: 'r1', newRichMenuId: 'line-r1' }]),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.unlinkIndividualLinks).toHaveBeenCalledWith(expect.objectContaining({ id: 'restore-assign' }));
    expect(dbMocks.clearRichMenuAssignmentsForGroup).toHaveBeenCalledWith(db, 'menu-1');
    expect(result).toMatchObject({ restored: 1 });
  });
});
