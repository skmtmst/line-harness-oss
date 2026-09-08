import {
  RICH_MENU_SCHEDULE_MAX_ATTEMPTS,
  RICH_MENU_SCHEDULE_STALE_MS,
  cancelRichMenuSchedule,
  claimRichMenuSchedule,
  claimRichMenuScheduleRestore,
  classifyRichMenuScheduleError,
  getDueRichMenuScheduleRestores,
  getDueRichMenuSchedules,
  getStalePublishingSchedules,
  getStaleRestoringSchedules,
  listRichMenuSchedulesByGroup,
  nextRichMenuScheduleRetryAt,
  reclaimStalePublishingSchedule,
  reclaimStaleRestoringSchedule,
  recordRichMenuSchedulePermanentFailure,
  recordRichMenuScheduleRestoreSuccess,
  recordRichMenuScheduleRestoreTransientFailure,
  recordRichMenuScheduleSuccess,
  recordRichMenuScheduleTransientFailure,
  type RichMenuScheduleRow,
  type RichMenuGroupWithPages,
} from '@line-crm/db';
import { toJstString } from '@line-crm/db';

// E-08 (#621): 保存済み公開予約を時刻到来時に実行する。
// 読むcronが無かったため時刻を過ぎても公開されなかった問題を直す。
// 二重実行は claim の UPDATE 条件 (status + account_id) で防ぐ。
// staleになったpublishing/restoringはlease期限で回収し永久停止させない。

export type ScheduleLineAccount = {
  id: string;
  channel_access_token: string | null;
  is_active?: number | null;
  archived_at?: string | null;
};

export type ScheduleStaff = {
  id: string;
  role: 'owner' | 'admin' | 'staff';
  is_active: number;
  access_level?: string | null;
};

export type RichMenuScheduleExecutorDeps = {
  getGroupWithPages: (db: D1Database, groupId: string) => Promise<RichMenuGroupWithPages | null>;
  getLineAccount: (
    db: D1Database,
    accountId: string,
  ) => Promise<ScheduleLineAccount | null>;
  getRequestingStaff: (
    db: D1Database,
    staffId: string,
  ) => Promise<ScheduleStaff | null>;
  isStaffAllowedForAccount: (
    db: D1Database,
    staffId: string,
    accountId: string,
  ) => Promise<boolean>;
  /** 予約時のスナップショットをLINEへ出す。本番は publishRichMenuGroup を呼ぶ。 */
  publishSnapshot: (snapshot: unknown, schedule: RichMenuScheduleRow) => Promise<void>;
  /**
   * 期間終了時の復元。restoreGroupId=nullは「前のメニューに戻す」で戻し先が
   * 無かった場合の明示的default解除として扱う。本番はLINEのdefault解除を行う。
   */
  restoreToGroup: (restoreGroupId: string | null, schedule: RichMenuScheduleRow) => Promise<void>;
};

export type RichMenuScheduleProcessResult = {
  processed: number;
  succeeded: number;
  restored: number;
  retried: number;
  failed: number;
  skipped: number;
  reclaimed: number;
};

function parseSnapshot(snapshot: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(snapshot) };
  } catch {
    return { ok: false, error: 'definition_snapshot is not JSON' };
  }
}

function snapshotHasPublishablePages(snapshot: unknown): boolean {
  if (typeof snapshot !== 'object' || snapshot === null) return false;
  const pages = (snapshot as { pages?: unknown }).pages;
  return Array.isArray(pages) && pages.length > 0;
}

/**
 * 外部LINE成功後・DB記録前の停止で二重作成しないための簡易判定。
 * claimでstarted_run_idが残ったままgroupが公開済みなら、前回の公開が
 * LINE側まで終わっていたとみなして再公開せず成功記録だけ行う。
 * 初回(started_run_id=null)の公開済みは予約前からの状態のため再公開する。
 */
function isPublishAlreadyApplied(
  group: RichMenuGroupWithPages,
  schedule: RichMenuScheduleRow,
): boolean {
  if (group.status !== 'published') return false;
  return schedule.started_run_id !== null;
}

async function checkAccountAndStaff(
  db: D1Database,
  schedule: RichMenuScheduleRow,
  deps: RichMenuScheduleExecutorDeps,
): Promise<string | null> {
  const account = await deps.getLineAccount(db, schedule.account_id);
  if (!account) return 'line account not found';
  if (account.archived_at) return 'account_archived: line account is archived';
  if (account.is_active === 0) return 'account_inactive: line account is stopped';
  if (!account.channel_access_token) {
    return 'LINE credential missing, try again';
  }
  // 予約者の現在状態を再確認。env-ownerはDB行が無いため通す。
  if (schedule.requested_by_staff_id !== 'env-owner') {
    const staff = await deps.getRequestingStaff(db, schedule.requested_by_staff_id);
    if (!staff || staff.is_active !== 1) return 'staff_inactive: requester is disabled';
    if (staff.role !== 'owner' && staff.role !== 'admin') {
      return 'staff_forbidden: requester lost owner/admin role';
    }
    if (staff.access_level === 'read_only') return 'staff_forbidden: requester is read-only';
    const allowed = await deps.isStaffAllowedForAccount(db, staff.id, schedule.account_id);
    if (!allowed) return 'staff_forbidden: requester lost account visibility';
  }
  return null;
}

async function handleOneSchedule(
  db: D1Database,
  schedule: RichMenuScheduleRow,
  now: Date,
  deps: RichMenuScheduleExecutorDeps,
  runId: string,
): Promise<'succeeded' | 'retried' | 'failed' | 'skipped'> {
  const claimed = await claimRichMenuSchedule(db, schedule.id, schedule.account_id, runId, now.toISOString());
  if (!claimed) return 'skipped';

  const attemptCount = schedule.attempt_count + 1;
  const fail = async (error: unknown) => {
    const classified = classifyRichMenuScheduleError(error);
    if (classified.retryable && attemptCount < RICH_MENU_SCHEDULE_MAX_ATTEMPTS) {
      await recordRichMenuScheduleTransientFailure(
        db,
        schedule.id,
        schedule.account_id,
        classified.code,
        nextRichMenuScheduleRetryAt(now, attemptCount),
      );
      return 'retried' as const;
    }
    await recordRichMenuSchedulePermanentFailure(db, schedule.id, schedule.account_id, runId, classified.code);
    return 'failed' as const;
  };

  try {
    // 実行直前の安全再評価。予約時と変わっていたら出さない。
    const group = await deps.getGroupWithPages(db, schedule.group_id);
    if (!group) return fail(new Error('schedule group not found'));
    if (group.account_id !== schedule.account_id) return fail(new Error('schedule account mismatch'));
    const preconditionError = await checkAccountAndStaff(db, schedule, deps);
    if (preconditionError) return fail(new Error(preconditionError));
    const parsed = parseSnapshot(schedule.definition_snapshot);
    if (!parsed.ok) return fail(new Error(parsed.error));
    if (!snapshotHasPublishablePages(parsed.value)) return fail(new Error('definition_snapshot has no pages'));
    if (schedule.mode === 'period' && schedule.restore_group_id) {
      const restore = await deps.getGroupWithPages(db, schedule.restore_group_id);
      if (!restore || restore.account_id !== schedule.account_id || restore.status !== 'published') {
        return fail(new Error('restoreGroupId must be a published menu'));
      }
    }

    // 外部LINE成功後・DB記録前の停止で再試行する場合は二重作成しない。
    // 前回の公開でgroupが公開済みかつstarted_run_idが残っていれば
    // LINE呼び出しを飛ばして成功記録だけ行う。
    if (isPublishAlreadyApplied(group, schedule)) {
      await recordRichMenuScheduleSuccess(
        db,
        schedule.id,
        schedule.account_id,
        runId,
        schedule.mode === 'period' ? 'published' : 'completed',
      );
      return 'succeeded';
    }

    await deps.publishSnapshot(parsed.value, schedule);
    await recordRichMenuScheduleSuccess(
      db,
      schedule.id,
      schedule.account_id,
      runId,
      schedule.mode === 'period' ? 'published' : 'completed',
    );
    return 'succeeded';
  } catch (error) {
    return fail(error);
  }
}

async function handleOneRestore(
  db: D1Database,
  schedule: RichMenuScheduleRow,
  now: Date,
  deps: RichMenuScheduleExecutorDeps,
  runId: string,
): Promise<'restored' | 'retried' | 'failed' | 'skipped'> {
  const claimed = await claimRichMenuScheduleRestore(db, schedule.id, schedule.account_id, runId);
  if (!claimed) return 'skipped';

  const attemptCount = schedule.attempt_count + 1;
  const fail = async (error: unknown) => {
    const classified = classifyRichMenuScheduleError(error);
    if (classified.retryable && attemptCount < RICH_MENU_SCHEDULE_MAX_ATTEMPTS) {
      await recordRichMenuScheduleRestoreTransientFailure(
        db,
        schedule.id,
        schedule.account_id,
        classified.code,
        nextRichMenuScheduleRetryAt(now, attemptCount),
      );
      return 'retried' as const;
    }
    await recordRichMenuSchedulePermanentFailure(db, schedule.id, schedule.account_id, runId, classified.code);
    return 'failed' as const;
  };

  try {
    const preconditionError = await checkAccountAndStaff(db, schedule, deps);
    if (preconditionError) return fail(new Error(preconditionError));
    const scheduledGroup = await deps.getGroupWithPages(db, schedule.group_id);
    if (!scheduledGroup || scheduledGroup.account_id !== schedule.account_id) {
      return fail(new Error('schedule group not found'));
    }
    if (schedule.restore_group_id) {
      const restore = await deps.getGroupWithPages(db, schedule.restore_group_id);
      if (!restore || restore.account_id !== schedule.account_id || restore.status !== 'published') {
        return fail(new Error('restoreGroupId must be a published menu'));
      }
      // 復元claim済み(ended_run_idあり)で、復元先が公開中かつ対象が公開中で
      // なければ前回復元まで終わっていたとみなして再実行しない。
      const scheduledStatus = (scheduledGroup as { status?: string }).status;
      if (schedule.ended_run_id !== null && scheduledStatus !== 'published') {
        await recordRichMenuScheduleRestoreSuccess(db, schedule.id, schedule.account_id, runId);
        return 'restored';
      }
    } else {
      // restoreGroupId=nullは予約時点に戻し先が無かった場合の明示的default解除。
      // 復元claim済みで既に公開が外れていれば再実行しない。初回は必ず解除を行う。
      const scheduledStatus = (scheduledGroup as { status?: string }).status;
      if (schedule.ended_run_id !== null && scheduledStatus !== 'published') {
        await recordRichMenuScheduleRestoreSuccess(db, schedule.id, schedule.account_id, runId);
        return 'restored';
      }
    }
    await deps.restoreToGroup(schedule.restore_group_id, schedule);
    await recordRichMenuScheduleRestoreSuccess(db, schedule.id, schedule.account_id, runId);
    return 'restored';
  } catch (error) {
    return fail(error);
  }
}

async function reclaimStaleClaims(
  db: D1Database,
  now: Date,
  limit: number,
): Promise<number> {
  const staleBeforeJst = toJstString(new Date(now.getTime() - RICH_MENU_SCHEDULE_STALE_MS));
  let reclaimed = 0;
  const publishing = await getStalePublishingSchedules(db, staleBeforeJst, limit);
  for (const row of publishing) {
    const ok = await reclaimStalePublishingSchedule(db, row.id, row.account_id, staleBeforeJst);
    if (ok) reclaimed += 1;
  }
  const restoring = await getStaleRestoringSchedules(db, staleBeforeJst, limit);
  for (const row of restoring) {
    const ok = await reclaimStaleRestoringSchedule(db, row.id, row.account_id, staleBeforeJst);
    if (ok) reclaimed += 1;
  }
  return reclaimed;
}

export async function processDueRichMenuSchedules(
  db: D1Database,
  deps: RichMenuScheduleExecutorDeps,
  options: { now?: Date; limit?: number; runIdPrefix?: string } = {},
): Promise<RichMenuScheduleProcessResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 20;
  const result: RichMenuScheduleProcessResult = {
    processed: 0,
    succeeded: 0,
    restored: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    reclaimed: 0,
  };

  // staleなclaimを先に戻して永久停止させない。回収後に通常のdue取得へ含める。
  try {
    result.reclaimed = await reclaimStaleClaims(db, now, limit);
  } catch (error) {
    console.error('rich-menu schedule reclaim error:', error);
  }

  const due = await getDueRichMenuSchedules(db, now.toISOString(), limit);
  for (const schedule of due) {
    result.processed += 1;
    const runId = `${options.runIdPrefix ?? 'rms'}-${schedule.id}-${Date.now()}`;
    const outcome = await handleOneSchedule(db, schedule, now, deps, runId);
    if (outcome === 'succeeded') result.succeeded += 1;
    else if (outcome === 'retried') result.retried += 1;
    else if (outcome === 'failed') result.failed += 1;
    else result.skipped += 1;
  }

  const restores = await getDueRichMenuScheduleRestores(db, now.toISOString(), limit);
  for (const schedule of restores) {
    result.processed += 1;
    const runId = `${options.runIdPrefix ?? 'rms'}-${schedule.id}-restore-${Date.now()}`;
    const outcome = await handleOneRestore(db, schedule, now, deps, runId);
    if (outcome === 'restored') result.restored += 1;
    else if (outcome === 'retried') result.retried += 1;
    else if (outcome === 'failed') result.failed += 1;
    else result.skipped += 1;
  }

  return result;
}

export { listRichMenuSchedulesByGroup, cancelRichMenuSchedule };
