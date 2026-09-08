import {
  RICH_MENU_SCHEDULE_MAX_ATTEMPTS,
  RICH_MENU_SCHEDULE_STALE_MS,
  acquirePublishLock,
  cancelRichMenuSchedule,
  claimRichMenuSchedule,
  claimRichMenuScheduleRestore,
  classifyRichMenuScheduleError,
  clearRichMenuAssignmentsForGroup,
  detectSnapshotPageDrift,
  getDueRichMenuScheduleRestores,
  getDueRichMenuSchedules,
  getRichMenuScheduleById,
  getSchedulePublications,
  getStalePublishingSchedules,
  getStaleRestoringSchedules,
  listRichMenuSchedulesByGroup,
  markRichMenuGroupPublished,
  markRichMenuGroupUnpublished,
  nextRichMenuScheduleRetryAt,
  reclaimStalePublishingSchedule,
  reclaimStaleRestoringSchedule,
  recordRichMenuSchedulePermanentFailure,
  recordRichMenuScheduleRestoreSuccess,
  recordRichMenuScheduleRestoreTransientFailure,
  recordRichMenuScheduleSuccess,
  recordRichMenuScheduleTransientFailure,
  recordSchedulePublications,
  releasePublishLock,
  setPageRichMenuId,
  type RichMenuScheduleRow,
  type RichMenuGroupWithPages,
} from '@line-crm/db';
import { toJstString } from '@line-crm/db';

// E-08 (#621): 保存済み公開予約を時刻到来時に実行する。
// 読むcronが無かったため時刻を過ぎても公開されなかった問題を直す。
// 二重実行は claim の UPDATE 条件 (status + account_id) で防ぐ。
// staleになったpublishing/restoringはlease期限で回収し永久停止させない。
// 独立レビュー再修正: lease fencing(run ID付き)・durable journal・snapshot drift・
// 個別割当復元・group lockを足し、group.statusだけでの完成判定をやめた。

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

export type PublishedPageMapping = { pageId: string; newRichMenuId: string };

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
  /**
   * 予約時のスナップショットをLINEへ出す。新しいLINE IDの一覧を返す。
   * journal未記録の場合だけLINEを呼び、既存journalがある場合は呼ばない。
   * 本番は publishRichMenuGroup を呼ぶ。テストはモックで件数を数える。
   */
  publishSnapshot: (
    snapshot: unknown,
    schedule: RichMenuScheduleRow,
  ) => Promise<PublishedPageMapping[] | void>;
  /**
   * 期間終了時の復元。restoreGroupId=nullは「前のメニューに戻す」で戻し先が
   * 無かった場合の明示的default解除として扱う。本番はLINEのdefault解除を行う。
   * 非null時は新しいLINE IDの一覧を返す。
   */
  restoreToGroup: (
    restoreGroupId: string | null,
    schedule: RichMenuScheduleRow,
  ) => Promise<PublishedPageMapping[] | void>;
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

  // claim直後の行を読み直す。引数のscheduleはdue取得時の古い写しのため、
  // attemptやrunの判断に使わない（stale再開の完成誤判定を防ぐ）。
  const fresh = await getRichMenuScheduleById(db, schedule.id, schedule.account_id);
  if (!fresh || fresh.status !== 'publishing' || fresh.started_run_id !== runId) {
    return 'skipped';
  }
  const attemptCount = fresh.attempt_count;
  const fail = async (error: unknown): Promise<'retried' | 'failed' | 'skipped'> => {
    const classified = classifyRichMenuScheduleError(error);
    if (classified.retryable && attemptCount < RICH_MENU_SCHEDULE_MAX_ATTEMPTS) {
      const recorded = await recordRichMenuScheduleTransientFailure(
        db,
        schedule.id,
        schedule.account_id,
        runId,
        classified.code,
        nextRichMenuScheduleRetryAt(now, attemptCount),
      );
      return recorded ? 'retried' : 'skipped';
    }
    const recorded = await recordRichMenuSchedulePermanentFailure(db, schedule.id, schedule.account_id, runId, classified.code);
    return recorded ? 'failed' : 'skipped';
  };

  try {
    // 実行直前の安全再評価。予約時と変わっていたら出さない。
    const group = await deps.getGroupWithPages(db, schedule.group_id);
    if (!group) return fail(new Error('schedule group not found'));
    if (group.account_id !== schedule.account_id) return fail(new Error('schedule account mismatch'));
    const preconditionError = await checkAccountAndStaff(db, fresh, deps);
    if (preconditionError) return fail(new Error(preconditionError));
    const parsed = parseSnapshot(fresh.definition_snapshot);
    if (!parsed.ok) return fail(new Error(parsed.error));
    if (!snapshotHasPublishablePages(parsed.value)) return fail(new Error('definition_snapshot has no pages'));
    // 予約後の下書き編集・ページ削除のずれ。消えたpageがあれば恒久失敗。
    const drift = detectSnapshotPageDrift(
      parsed.value,
      (group.pages ?? []).map((page) => page.id),
    );
    if (drift) return fail(new Error(drift));
    if (fresh.mode === 'period' && fresh.restore_group_id) {
      const restore = await deps.getGroupWithPages(db, fresh.restore_group_id);
      if (!restore || restore.account_id !== fresh.account_id || restore.status !== 'published') {
        return fail(new Error('restoreGroupId must be a published menu'));
      }
    }

    // durable journalがあり、LINE作成まで終わっていたら作り直さない。
    // journalのIDをDBへ反映して成功記録だけ行う（LINE呼び出し0回で完了はこの場合だけ正しい）。
    const journal = await getSchedulePublications(db, fresh.id, 'publish');
    if (journal.length > 0) {
      for (const entry of journal) {
        await setPageRichMenuId(db, entry.page_id, entry.line_richmenu_id);
      }
      await markRichMenuGroupPublished(db, fresh.group_id);
      const recorded = await recordRichMenuScheduleSuccess(
        db,
        fresh.id,
        fresh.account_id,
        runId,
        fresh.mode === 'period' ? 'published' : 'completed',
      );
      return recorded ? 'succeeded' : 'skipped';
    }

    // 手動公開との競合を防ぐためgroup lockを取る。取れなければ一時失敗で再試行。
    const locked = await acquirePublishLock(db, fresh.group_id);
    if (!locked) {
      return fail(new Error('publish_locked: group is publishing, try again'));
    }
    try {
      const mappings = (await deps.publishSnapshot(parsed.value, fresh)) ?? [];
      const pages = (mappings as PublishedPageMapping[]).map((mapping) => ({
        pageId: mapping.pageId,
        lineRichMenuId: mapping.newRichMenuId,
      }));
      // LINE成功を先にjournalへ残す。以後のD1失敗は再実行でjournal照合し作り直さない。
      await recordSchedulePublications(db, fresh.id, 'publish', runId, pages);
      for (const page of pages) {
        await setPageRichMenuId(db, page.pageId, page.lineRichMenuId);
      }
      await markRichMenuGroupPublished(db, fresh.group_id);
    } catch (error) {
      try {
        await releasePublishLock(db, fresh.group_id);
      } catch {
        // ロック解除の失敗は元のエラーを隠さない。
      }
      return fail(error);
    }
    const recorded = await recordRichMenuScheduleSuccess(
      db,
      fresh.id,
      fresh.account_id,
      runId,
      fresh.mode === 'period' ? 'published' : 'completed',
    );
    return recorded ? 'succeeded' : 'skipped';
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

  const fresh = await getRichMenuScheduleById(db, schedule.id, schedule.account_id);
  if (!fresh || fresh.status !== 'restoring' || fresh.ended_run_id !== runId) {
    return 'skipped';
  }
  const attemptCount = fresh.attempt_count;
  const fail = async (error: unknown): Promise<'retried' | 'failed' | 'skipped'> => {
    const classified = classifyRichMenuScheduleError(error);
    if (classified.retryable && attemptCount < RICH_MENU_SCHEDULE_MAX_ATTEMPTS) {
      const recorded = await recordRichMenuScheduleRestoreTransientFailure(
        db,
        schedule.id,
        schedule.account_id,
        runId,
        classified.code,
        nextRichMenuScheduleRetryAt(now, attemptCount),
      );
      return recorded ? 'retried' : 'skipped';
    }
    const recorded = await recordRichMenuSchedulePermanentFailure(db, schedule.id, schedule.account_id, runId, classified.code);
    return recorded ? 'failed' : 'skipped';
  };

  try {
    const preconditionError = await checkAccountAndStaff(db, fresh, deps);
    if (preconditionError) return fail(new Error(preconditionError));
    const scheduledGroup = await deps.getGroupWithPages(db, fresh.group_id);
    if (!scheduledGroup || scheduledGroup.account_id !== fresh.account_id) {
      return fail(new Error('schedule group not found'));
    }
    if (fresh.restore_group_id) {
      const restore = await deps.getGroupWithPages(db, fresh.restore_group_id);
      if (!restore || restore.account_id !== fresh.account_id || restore.status !== 'published') {
        return fail(new Error('restoreGroupId must be a published menu'));
      }
      // journal済みならLINEを作り直さずDB反映だけ行う。
      const journal = await getSchedulePublications(db, fresh.id, 'restore');
      if (journal.length > 0) {
        for (const entry of journal) {
          await setPageRichMenuId(db, entry.page_id, entry.line_richmenu_id);
        }
        await markRichMenuGroupPublished(db, fresh.restore_group_id);
        if (fresh.restore_group_id !== fresh.group_id) {
          await markRichMenuGroupUnpublished(db, fresh.group_id);
        }
        await clearRichMenuAssignmentsForGroup(db, fresh.group_id);
        const recorded = await recordRichMenuScheduleRestoreSuccess(db, fresh.id, fresh.account_id, runId);
        return recorded ? 'restored' : 'skipped';
      }
      const locked = await acquirePublishLock(db, fresh.restore_group_id);
      if (!locked) {
        return fail(new Error('publish_locked: group is publishing, try again'));
      }
      try {
        const mappings = (await deps.restoreToGroup(fresh.restore_group_id, fresh)) ?? [];
        const pages = (mappings as PublishedPageMapping[]).map((mapping) => ({
          pageId: mapping.pageId,
          lineRichMenuId: mapping.newRichMenuId,
        }));
        await recordSchedulePublications(db, fresh.id, 'restore', runId, pages);
        for (const page of pages) {
          await setPageRichMenuId(db, page.pageId, page.lineRichMenuId);
        }
        await markRichMenuGroupPublished(db, fresh.restore_group_id);
        if (fresh.restore_group_id !== fresh.group_id) {
          await markRichMenuGroupUnpublished(db, fresh.group_id);
        }
        // 終了時に期限切れメニューの個別割当を外す。残すと古いメニューを指し続ける。
        await clearRichMenuAssignmentsForGroup(db, fresh.group_id);
      } catch (error) {
        try {
          await releasePublishLock(db, fresh.restore_group_id);
        } catch {
          // ロック解除の失敗は元のエラーを隠さない。
        }
        return fail(error);
      }
    } else {
      // restoreGroupId=nullは予約時点に戻し先が無かった場合の明示的default解除。
      // LINEのdefault解除はidempotentのためjournalなしで再試行できる。
      const locked = await acquirePublishLock(db, fresh.group_id);
      if (!locked) {
        return fail(new Error('publish_locked: group is publishing, try again'));
      }
      try {
        await deps.restoreToGroup(null, fresh);
        await markRichMenuGroupUnpublished(db, fresh.group_id);
        await clearRichMenuAssignmentsForGroup(db, fresh.group_id);
      } catch (error) {
        try {
          await releasePublishLock(db, fresh.group_id);
        } catch {
          // ロック解除の失敗は元のエラーを隠さない。
        }
        return fail(error);
      }
    }
    const recorded = await recordRichMenuScheduleRestoreSuccess(db, fresh.id, fresh.account_id, runId);
    return recorded ? 'restored' : 'skipped';
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
