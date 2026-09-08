import {
  RICH_MENU_SCHEDULE_MAX_ATTEMPTS,
  cancelRichMenuSchedule,
  claimRichMenuSchedule,
  claimRichMenuScheduleRestore,
  classifyRichMenuScheduleError,
  getDueRichMenuScheduleRestores,
  getDueRichMenuSchedules,
  listRichMenuSchedulesByGroup,
  nextRichMenuScheduleRetryAt,
  recordRichMenuSchedulePermanentFailure,
  recordRichMenuScheduleRestoreSuccess,
  recordRichMenuScheduleRestoreTransientFailure,
  recordRichMenuScheduleSuccess,
  recordRichMenuScheduleTransientFailure,
  type RichMenuScheduleRow,
  type RichMenuGroupWithPages,
} from '@line-crm/db';

// E-08 (#621): 保存済み公開予約を時刻到来時に実行する。
// 読むcronが無かったため時刻を過ぎても公開されなかった問題を直す。
// 二重実行は claim の UPDATE 条件 (status + account_id) で防ぐ。

export type RichMenuScheduleExecutorDeps = {
  getGroupWithPages: (db: D1Database, groupId: string) => Promise<RichMenuGroupWithPages | null>;
  getLineAccount: (
    db: D1Database,
    accountId: string,
  ) => Promise<{ id: string; channel_access_token: string | null } | null>;
  /** 予約時のスナップショットをLINEへ出す。本番は publishRichMenuGroup を呼ぶ。 */
  publishSnapshot: (snapshot: unknown, schedule: RichMenuScheduleRow) => Promise<void>;
  /** 期間終了時の復元。本番は復元先グループの公開か完了記録を行う。 */
  restoreToGroup: (restoreGroupId: string | null, schedule: RichMenuScheduleRow) => Promise<void>;
};

export type RichMenuScheduleProcessResult = {
  processed: number;
  succeeded: number;
  restored: number;
  retried: number;
  failed: number;
  skipped: number;
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
    const account = await deps.getLineAccount(db, schedule.account_id);
    if (!account) return fail(new Error('line account not found'));
    if (!account.channel_access_token) {
      return fail(new Error('LINE credential missing, try again'));
    }
    const parsed = parseSnapshot(schedule.definition_snapshot);
    if (!parsed.ok) return fail(new Error(parsed.error));
    if (!snapshotHasPublishablePages(parsed.value)) return fail(new Error('definition_snapshot has no pages'));
    if (schedule.mode === 'period' && schedule.restore_group_id) {
      const restore = await deps.getGroupWithPages(db, schedule.restore_group_id);
      if (!restore || restore.account_id !== schedule.account_id || restore.status !== 'published') {
        return fail(new Error('restoreGroupId must be a published menu'));
      }
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
    if (schedule.restore_group_id) {
      const restore = await deps.getGroupWithPages(db, schedule.restore_group_id);
      if (!restore || restore.account_id !== schedule.account_id) {
        return fail(new Error('restoreGroupId must be a published menu'));
      }
    }
    await deps.restoreToGroup(schedule.restore_group_id, schedule);
    await recordRichMenuScheduleRestoreSuccess(db, schedule.id, schedule.account_id, runId);
    return 'restored';
  } catch (error) {
    return fail(error);
  }
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
  };

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
