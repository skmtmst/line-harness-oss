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
  clearSchedulePublications: vi.fn(),
  getScheduleRestoreDefaultPin: vi.fn(),
  pinScheduleRestoreDefault: vi.fn(),
  recordRichMenuScheduleSuccess: vi.fn(),
  recordRichMenuScheduleRestoreSuccess: vi.fn(),
  recordRichMenuScheduleTransientFailure: vi.fn(),
  recordRichMenuScheduleRestoreTransientFailure: vi.fn(),
  recordRichMenuSchedulePermanentFailure: vi.fn(),
  acquirePublishLease: vi.fn(),
  renewPublishLease: vi.fn(),
  renewScheduleLease: vi.fn(),
  releasePublishLease: vi.fn(),
  setPageRichMenuId: vi.fn(),
  markRichMenuGroupPublished: vi.fn(),
  markRichMenuGroupUnpublished: vi.fn(),
  clearRichMenuAssignmentsForGroup: vi.fn(),
  detectSnapshotPageDrift: vi.fn((_snapshot: unknown, _current: string[]): string | null => null),
  classifyRichMenuScheduleError: vi.fn((error: unknown) => {
    const message = String(error instanceof Error ? error.message : error);
    if (/has no image|must be a published menu|not found|mismatch|account_inactive|account_archived|staff_inactive|staff_forbidden|snapshot drift|no_restore_target|no_default_pin/i.test(message)) {
      return { code: message.slice(0, 120), retryable: false };
    }
    return { code: message.slice(0, 120), retryable: true };
  }),
  nextRichMenuScheduleRetryAt: vi.fn((_now: Date, _attempt: number) => '2026-09-10T01:01:00.000Z'),
  listRichMenuSchedulesByGroup: vi.fn(),
  cancelRichMenuSchedule: vi.fn(),
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
    restore_default_state: null,
    restore_default_line_id: null,
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

function groupWithPages(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'menu-1',
    account_id: 'account-1',
    status: 'draft',
    is_default_for_all: 0,
    pages: [{ id: 'p1', order_index: 0, line_richmenu_id: null }],
    ...overrides,
  };
}

function deps(overrides = {}) {
  return {
    getGroupWithPages: vi.fn().mockResolvedValue(groupWithPages()),
    getLineAccount: vi.fn().mockResolvedValue({ id: 'account-1', channel_access_token: 'token', is_active: 1, archived_at: null }),
    getRequestingStaff: vi.fn().mockResolvedValue({ id: 'staff-1', role: 'owner', is_active: 1, access_level: 'full' }),
    isStaffAllowedForAccount: vi.fn().mockResolvedValue(true),
    createLineShells: vi.fn().mockResolvedValue([
      { pageId: 'p1', orderIndex: 0, newRichMenuId: 'line-p1', oldLineRichMenuId: null },
    ]),
    createRestoreShells: vi.fn().mockResolvedValue([
      { pageId: 'r1', orderIndex: 0, newRichMenuId: 'line-r1', oldLineRichMenuId: null },
    ]),
    readCurrentDefaultId: vi.fn().mockResolvedValue(null),
    switchLiveTo: vi.fn().mockResolvedValue(undefined),
    compensateSwitchToPrevious: vi.fn().mockResolvedValue({
      unrestoredPageIds: new Set(),
      defaultRestore: { state: 'restored' },
    }),
    deleteLineShells: vi.fn().mockResolvedValue(undefined),
    restoreCapturedDefault: vi.fn().mockResolvedValue(undefined),
    clearAccountDefault: vi.fn().mockResolvedValue(undefined),
    unlinkIndividualLinks: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

const now = new Date('2026-09-10T01:00:00.000Z');

const claimedStartRuns = new Map<string, string>();
const claimedRestoreRuns = new Map<string, string>();
// journalの簡易永続化。record→getで読めるようにし、clearで消える。
const journalStore = new Map<string, Array<{ pageId: string; lineRichMenuId: string }>>();

beforeEach(() => {
  // 実装の付け替え(mockRejectedValue等)が次のテストへ漏れないよう全消しする。
  vi.resetAllMocks();
  claimedStartRuns.clear();
  claimedRestoreRuns.clear();
  journalStore.clear();
  dbMocks.getDueRichMenuSchedules.mockResolvedValue([]);
  dbMocks.getDueRichMenuScheduleRestores.mockResolvedValue([]);
  dbMocks.getStalePublishingSchedules.mockResolvedValue([]);
  dbMocks.getStaleRestoringSchedules.mockResolvedValue([]);
  dbMocks.getSchedulePublications.mockImplementation(async (_db: unknown, scheduleId: string, kind: string) => (
    (journalStore.get(`${scheduleId}:${kind}`) ?? []).map((page) => ({
      schedule_id: scheduleId,
      kind,
      page_id: page.pageId,
      line_richmenu_id: page.lineRichMenuId,
      run_id: 'run-test',
      created_at: '2026-09-10T01:00:00.000Z',
    })) as never
  ));
  dbMocks.recordSchedulePublications.mockImplementation(async (_db: unknown, scheduleId: string, kind: string, _runId: string, pages: Array<{ pageId: string; lineRichMenuId: string }>) => {
    journalStore.set(`${scheduleId}:${kind}`, pages);
  });
  dbMocks.getScheduleRestoreDefaultPin.mockResolvedValue(null);
  dbMocks.pinScheduleRestoreDefault.mockResolvedValue(true);
  dbMocks.clearSchedulePublications.mockImplementation(async (_db: unknown, scheduleId: string, kind: string) => {
    journalStore.delete(`${scheduleId}:${kind}`);
  });
  dbMocks.acquirePublishLease.mockResolvedValue(1);
  dbMocks.renewPublishLease.mockResolvedValue(true);
  dbMocks.renewScheduleLease.mockResolvedValue(true);
  dbMocks.releasePublishLease.mockResolvedValue(true);
  dbMocks.setPageRichMenuId.mockResolvedValue(true);
  dbMocks.markRichMenuGroupPublished.mockResolvedValue(true);
  dbMocks.markRichMenuGroupUnpublished.mockResolvedValue(true);
  dbMocks.clearRichMenuAssignmentsForGroup.mockResolvedValue(undefined);
  dbMocks.recordRichMenuScheduleSuccess.mockResolvedValue(true);
  dbMocks.recordRichMenuScheduleRestoreSuccess.mockResolvedValue(true);
  dbMocks.recordRichMenuScheduleTransientFailure.mockResolvedValue(true);
  dbMocks.recordRichMenuScheduleRestoreTransientFailure.mockResolvedValue(true);
  dbMocks.recordRichMenuSchedulePermanentFailure.mockResolvedValue(true);
  dbMocks.detectSnapshotPageDrift.mockReturnValue(null);
  dbMocks.classifyRichMenuScheduleError.mockImplementation((error: unknown) => {
    const message = String(error instanceof Error ? error.message : error);
    if (/has no image|must be a published menu|not found|mismatch|account_inactive|account_archived|staff_inactive|staff_forbidden|snapshot drift|no_restore_target|no_default_pin/i.test(message)) {
      return { code: message.slice(0, 120), retryable: false };
    }
    return { code: message.slice(0, 120), retryable: true };
  });
  dbMocks.nextRichMenuScheduleRetryAt.mockImplementation((_now: Date, _attempt: number) => '2026-09-10T01:01:00.000Z');
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
  test('時刻到来の予約を段階公開し completed にする', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    const d = deps();

    const result = await processDueRichMenuSchedules(db, d, { now });
    // create → journal → 切替の順番。journal確定後に切替える。
    expect(d.createLineShells).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordSchedulePublications).toHaveBeenCalledTimes(1);
    expect(d.switchLiveTo).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordRichMenuScheduleSuccess).toHaveBeenCalledWith(
      db, 'schedule-1', 'account-1', expect.any(String), 'completed',
      // 確定は「自分が取ったあと誰もleaseを取っていない」を書込み条件にする。
      { groupId: 'menu-1', generation: 1 },
    );
    expect(result).toMatchObject({ processed: 1, succeeded: 1 });
  });

  test('同じ予約の二重取得は2本目を飛ばす', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    dbMocks.claimRichMenuSchedule.mockResolvedValue(false);
    const d = deps();

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.createLineShells).not.toHaveBeenCalled();
    expect(result).toMatchObject({ processed: 1, skipped: 1 });
  });

  test('leaseを取れなければ作らず次回へ回す', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    dbMocks.acquirePublishLease.mockResolvedValue(null);
    const d = deps();

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.createLineShells).not.toHaveBeenCalled();
    expect(d.switchLiveTo).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuScheduleTransientFailure).toHaveBeenCalled();
    expect(result).toMatchObject({ retried: 1 });
  });

  test('一時失敗は次回時刻付きで scheduled に戻す', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    const d = deps({ createLineShells: vi.fn().mockRejectedValue(new Error('fetch failed')) });

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
      createLineShells: vi.fn()
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockRejectedValueOnce(new Error('page p1 has no image')),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(dbMocks.recordRichMenuSchedulePermanentFailure).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ failed: 2 });
  });

  test('別アカウントの行は自分の公開に使わない', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule({ account_id: 'account-2' })]);
    const d = deps();

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.createLineShells).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuSchedulePermanentFailure).toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1 });
  });

  test('journal失敗は新メニューだけ消し、切替えない', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    dbMocks.recordSchedulePublications.mockRejectedValue(new Error('D1 journal down'));
    const d = deps();

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.createLineShells).toHaveBeenCalledTimes(1);
    expect(d.switchLiveTo).not.toHaveBeenCalled();
    // まだliveでない新メニューだけ消す。
    expect(d.deleteLineShells).toHaveBeenCalledWith(expect.anything(), ['line-p1']);
    expect(dbMocks.recordRichMenuScheduleTransientFailure).toHaveBeenCalled();
    expect(result).toMatchObject({ retried: 1 });
  });

  test('切替途中失敗は journal を消してから旧へ戻し、新メニューを片付ける', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    const d = deps({ switchLiveTo: vi.fn().mockRejectedValue(new Error('LINE alias 500, try again')) });
    const clearOrder: string[] = [];
    dbMocks.clearSchedulePublications.mockImplementation(async (_db: unknown, scheduleId: string, kind: string) => {
      journalStore.delete(`${scheduleId}:${kind}`);
      clearOrder.push('clear-journal');
    });
    d.compensateSwitchToPrevious.mockImplementation(async () => {
      clearOrder.push('compensate');
      return { unrestoredPageIds: new Set(), defaultRestore: { state: 'restored' } };
    });
    d.deleteLineShells.mockImplementation(async () => { clearOrder.push('delete-shells'); });

    const result = await processDueRichMenuSchedules(db, d, { now });
    // journalを残したまま新メニューを消さない順番。
    expect(clearOrder).toEqual(['clear-journal', 'compensate', 'delete-shells']);
    expect(d.deleteLineShells).toHaveBeenCalledWith(expect.anything(), ['line-p1']);
    expect(dbMocks.recordRichMenuScheduleTransientFailure).toHaveBeenCalled();
    expect(result).toMatchObject({ retried: 1 });
  });

  test('journalを消せなければ補償も削除もせず、再開に任せる', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    const d = deps({ switchLiveTo: vi.fn().mockRejectedValue(new Error('LINE alias 500, try again')) });
    dbMocks.clearSchedulePublications.mockRejectedValue(new Error('D1 down'));

    const result = await processDueRichMenuSchedules(db, d, { now });
    // journalが残っているのに新メニューを消すと再試行が壊れるため何もしない。
    expect(d.compensateSwitchToPrevious).not.toHaveBeenCalled();
    expect(d.deleteLineShells).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuScheduleTransientFailure).toHaveBeenCalled();
    expect(result).toMatchObject({ retried: 1 });
  });

  test('戻せなかったaliasの新メニューは消さない', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    const d = deps({
      switchLiveTo: vi.fn().mockRejectedValue(new Error('LINE alias 500, try again')),
      compensateSwitchToPrevious: vi.fn().mockResolvedValue({
        unrestoredPageIds: new Set(['p1']),
        defaultRestore: { state: 'restored' },
      }),
    });

    await processDueRichMenuSchedules(db, d, { now });
    expect(d.deleteLineShells).toHaveBeenCalledWith(expect.anything(), []);
  });

  test('journal再開は作り直さず切替えだけ行う', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    // journal確定後に停止した想定。作り直しはしない。
    dbMocks.getSchedulePublications.mockResolvedValue([
      { schedule_id: 'schedule-1', kind: 'publish', page_id: 'p1', line_richmenu_id: 'line-p1', run_id: 'run-old', created_at: 'x' },
    ]);
    const d = deps();

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.createLineShells).not.toHaveBeenCalled();
    expect(d.switchLiveTo).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordRichMenuScheduleSuccess).toHaveBeenCalled();
    expect(result).toMatchObject({ succeeded: 1 });
  });

  test('leaseを失った旧holderはDB確定せず手を引く', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([schedule()]);
    // 作成・pin・journal・切替までは持ち、反映前のrenewで失う。
    // renewは外部工程とDB確定の直前に毎回入るため、切替の次で false にする。
    let renewCalls = 0;
    dbMocks.renewPublishLease.mockImplementation(async () => {
      renewCalls += 1;
      return renewCalls <= 4;
    });
    const d = deps();

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.switchLiveTo).toHaveBeenCalledTimes(1);
    // DB確定（成功記録・page反映）はしない。回収した新所有者に任せる。
    expect(dbMocks.recordRichMenuScheduleSuccess).not.toHaveBeenCalled();
    expect(dbMocks.setPageRichMenuId).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuScheduleTransientFailure).toHaveBeenCalled();
    expect(result).toMatchObject({ retried: 1 });
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
    expect(d.createLineShells).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuSchedulePermanentFailure).toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1 });
  });

  test('期間モードは published で置き、明示の戻し先へ復元して completed にする', async () => {
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
        if (id === 'restore-1') return { id, account_id: 'account-1', status: 'published', is_default_for_all: 0, pages: [{ id: 'r1', order_index: 0, line_richmenu_id: null }] };
        return groupWithPages({ id: 'menu-1' });
      }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(dbMocks.recordRichMenuScheduleSuccess).toHaveBeenCalledWith(
      db, 'period-1', 'account-1', expect.any(String), 'published',
      { groupId: 'menu-1', generation: 1 },
    );
    expect(d.createRestoreShells).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordRichMenuScheduleRestoreSuccess).toHaveBeenCalled();
    expect(result).toMatchObject({ succeeded: 1, restored: 1 });
  });

  test('期間開始で切替前defaultを固定し、再試行は保存値を使う', async () => {
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([
      schedule({ id: 'pin-1', mode: 'period', restore_group_id: null }),
    ]);
    const d = deps({ readCurrentDefaultId: vi.fn().mockResolvedValue('line-old-1') });

    await processDueRichMenuSchedules(db, d, { now });
    expect(d.readCurrentDefaultId).toHaveBeenCalledTimes(1);
    expect(dbMocks.pinScheduleRestoreDefault).toHaveBeenCalledWith(
      db, 'pin-1', 'account-1', { state: 'captured', lineId: 'line-old-1' },
    );

    // 再試行（固定済み）は読み直さない。1回目の呼び出しきりで終わる。
    dbMocks.getScheduleRestoreDefaultPin.mockResolvedValue({ state: 'captured', lineId: 'line-old-1' });
    dbMocks.getDueRichMenuSchedules.mockResolvedValue([
      schedule({ id: 'pin-1', mode: 'period', restore_group_id: null }),
    ]);
    const d2 = deps({ readCurrentDefaultId: vi.fn().mockResolvedValue('line-changed') });
    await processDueRichMenuSchedules(db, d2, { now });
    expect(d2.readCurrentDefaultId).not.toHaveBeenCalled();
    expect(dbMocks.pinScheduleRestoreDefault).toHaveBeenCalledTimes(1);
  });

  test('固定capturedの復元は固定メニューへ戻す', async () => {
    dbMocks.getDueRichMenuScheduleRestores.mockResolvedValue([
      schedule({
        id: 'restore-pin-1', mode: 'period', status: 'published',
        restore_group_id: null, restore_default_state: 'captured', restore_default_line_id: 'line-old-1',
        started_run_id: 'rms-start', ended_run_id: null,
      }),
    ]);
    dbMocks.getRichMenuScheduleById.mockImplementation(async (_db: unknown, id: string) => (
      {
        ...schedule({ id, mode: 'period', restore_default_state: 'captured', restore_default_line_id: 'line-old-1' }),
        status: 'restoring', started_run_id: 'rms-start', ended_run_id: claimedRestoreRuns.get(id), attempt_count: 1,
      } as never
    ));
    const d = deps();

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.restoreCapturedDefault).toHaveBeenCalledWith(expect.objectContaining({ id: 'restore-pin-1' }), 'line-old-1');
    expect(d.clearAccountDefault).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuScheduleRestoreSuccess).toHaveBeenCalled();
    expect(result).toMatchObject({ restored: 1 });
  });

  test('固定メニューが消えていたら解除せず failed に残す', async () => {
    dbMocks.getDueRichMenuScheduleRestores.mockResolvedValue([
      schedule({
        id: 'restore-gone-1', mode: 'period', status: 'published',
        restore_group_id: null, restore_default_state: 'captured', restore_default_line_id: 'line-deleted',
        started_run_id: 'rms-start', ended_run_id: null,
      }),
    ]);
    dbMocks.getRichMenuScheduleById.mockImplementation(async (_db: unknown, id: string) => (
      {
        ...schedule({ id, mode: 'period', restore_default_state: 'captured', restore_default_line_id: 'line-deleted' }),
        status: 'restoring', started_run_id: 'rms-start', ended_run_id: claimedRestoreRuns.get(id), attempt_count: 1,
      } as never
    ));
    const d = deps({
      restoreCapturedDefault: vi.fn().mockRejectedValue(new Error('no_restore_target: pinned default menu line-deleted was deleted')),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    // 勝手に解除しない。
    expect(d.clearAccountDefault).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuSchedulePermanentFailure).toHaveBeenCalled();
    expect(dbMocks.recordRichMenuScheduleRestoreSuccess).not.toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1 });
  });

  test('no_default の復元だけ明示解除する', async () => {
    dbMocks.getDueRichMenuScheduleRestores.mockResolvedValue([
      schedule({
        id: 'restore-nodefault-1', mode: 'period', status: 'published',
        restore_group_id: null, restore_default_state: 'no_default', restore_default_line_id: null,
        started_run_id: 'rms-start', ended_run_id: null,
      }),
    ]);
    dbMocks.getRichMenuScheduleById.mockImplementation(async (_db: unknown, id: string) => (
      {
        ...schedule({ id, mode: 'period', restore_default_state: 'no_default' }),
        status: 'restoring', started_run_id: 'rms-start', ended_run_id: claimedRestoreRuns.get(id), attempt_count: 1,
      } as never
    ));
    const d = deps();

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.clearAccountDefault).toHaveBeenCalledTimes(1);
    expect(d.restoreCapturedDefault).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuScheduleRestoreSuccess).toHaveBeenCalled();
    expect(result).toMatchObject({ restored: 1 });
  });

  test('固定なしの復元は恒久失敗に残し、LINEを触らない', async () => {
    dbMocks.getDueRichMenuScheduleRestores.mockResolvedValue([
      schedule({
        id: 'restore-unpinned-1', mode: 'period', status: 'published',
        restore_group_id: null, restore_default_state: null,
        started_run_id: 'rms-start', ended_run_id: null,
      }),
    ]);
    dbMocks.getRichMenuScheduleById.mockImplementation(async (_db: unknown, id: string) => (
      {
        ...schedule({ id, mode: 'period' }),
        status: 'restoring', started_run_id: 'rms-start', ended_run_id: claimedRestoreRuns.get(id), attempt_count: 1,
      } as never
    ));
    const d = deps();

    const result = await processDueRichMenuSchedules(db, d, { now });
    expect(d.restoreCapturedDefault).not.toHaveBeenCalled();
    expect(d.clearAccountDefault).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuSchedulePermanentFailure).toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1 });
  });

  test('明示の戻し先が消えていたら解除せず failed に残す', async () => {
    dbMocks.getDueRichMenuScheduleRestores.mockResolvedValue([
      schedule({
        id: 'restore-explicit-gone-1', mode: 'period', status: 'published',
        restore_group_id: 'restore-deleted',
        started_run_id: 'rms-start', ended_run_id: null,
      }),
    ]);
    dbMocks.getRichMenuScheduleById.mockImplementation(async (_db: unknown, id: string) => (
      {
        ...schedule({ id, mode: 'period', restore_group_id: 'restore-deleted' }),
        status: 'restoring', started_run_id: 'rms-start', ended_run_id: claimedRestoreRuns.get(id), attempt_count: 1,
      } as never
    ));
    const d = deps({
      getGroupWithPages: vi.fn().mockImplementation(async (_db: unknown, id: string) => {
        if (id === 'restore-deleted') return null;
        return groupWithPages({ id: 'menu-1' });
      }),
    });

    const result = await processDueRichMenuSchedules(db, d, { now });
    // 黙ってdefault解除へ変えない。
    expect(d.clearAccountDefault).not.toHaveBeenCalled();
    expect(d.restoreCapturedDefault).not.toHaveBeenCalled();
    expect(d.createRestoreShells).not.toHaveBeenCalled();
    expect(dbMocks.recordRichMenuSchedulePermanentFailure).toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1 });
  });
});
