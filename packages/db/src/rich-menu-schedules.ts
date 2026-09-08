import { boundedListLimit, jstNow } from './utils.js';

// E-08 (#621): 公開予約の実行状態を DB で持つための最小ヘルパー。
// 342 で足した attempt_count / next_retry_at だけを使い、
// 上限回数はコード定数で持つ (列は増やさない)。

export const RICH_MENU_SCHEDULE_MAX_ATTEMPTS = 5;

/**
 * claim後にWorkerが止まった場合の回収までの待ち時間。
 * publishing/restoringのままupdated_atがこれより古ければstaleとして回収する。
 */
export const RICH_MENU_SCHEDULE_STALE_MS = 10 * 60_000;

export type RichMenuScheduleRow = {
  id: string;
  group_id: string;
  account_id: string;
  mode: 'scheduled' | 'period';
  starts_at: string;
  ends_at: string | null;
  restore_group_id: string | null;
  definition_snapshot: string;
  status: 'scheduled' | 'publishing' | 'published' | 'restoring' | 'completed' | 'cancelled' | 'failed';
  idempotency_key: string;
  requested_by_staff_id: string;
  started_run_id: string | null;
  ended_run_id: string | null;
  last_error_code: string | null;
  attempt_count: number;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
};

const TRANSIENT_PATTERNS = [
  '429', 'rate limit', 'rate_limit', 'ratelimit',
  'timeout', 'timed out', 'etimedout', 'econn', 'eai_again',
  'fetch failed', 'network', 'socket',
  '500', '502', '503', '504', '5xx',
  'temporarily', 'try again', 'busy',
];

const PERMANENT_PATTERNS = [
  'has no image', 'r2 image missing', 'validation',
  'must be', 'invalid', 'not found', 'permission', 'forbidden',
  'unauthorized', 'bad request', '400', '401', '403', '404',
  'snapshot', 'restoregroupid', 'restore_group',
  'account_inactive', 'account_archived', 'account_stopped',
  'staff_inactive', 'staff_forbidden', 'staff_revoked', 'no_restore_target',
];

/** 失敗を「もう一度試す一時失敗」と「人に対応してほしい恒久失敗」に分ける。 */
export function classifyRichMenuScheduleError(error: unknown): { code: string; retryable: boolean } {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? 'unknown');
  const lowered = message.toLowerCase().slice(0, 500);
  const code = lowered.slice(0, 120);
  if (PERMANENT_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    return { code, retryable: false };
  }
  if (TRANSIENT_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    return { code, retryable: true };
  }
  // 正体不明の失敗は一時失敗として上限まで試し、最後は failed に残す。
  return { code, retryable: true };
}

/** 次に試す時刻。1分から倍々に延ばす (1, 2, 4, 8, 16分)。 */
export function nextRichMenuScheduleRetryAt(now: Date, attemptCount: number): string {
  const minutes = Math.pow(2, Math.max(0, attemptCount - 1));
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export async function listRichMenuSchedulesByGroup(
  db: D1Database,
  groupId: string,
  limit?: number,
): Promise<RichMenuScheduleRow[]> {
  const bounded = boundedListLimit(limit, 50);
  const result = await db
    .prepare(
      `SELECT * FROM rich_menu_schedules WHERE group_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(groupId, bounded)
    .all<RichMenuScheduleRow>();
  return result.results ?? [];
}

/** 開始時刻を過ぎた予約。next_retry_at がある行は再試行時刻も過ぎたものだけ。 */
export async function getDueRichMenuSchedules(
  db: D1Database,
  nowIso: string,
  limit = 20,
): Promise<RichMenuScheduleRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM rich_menu_schedules
        WHERE status = 'scheduled'
          AND starts_at <= ?
          AND (next_retry_at IS NULL OR next_retry_at <= ?)
        ORDER BY starts_at ASC LIMIT ?`,
    )
    .bind(nowIso, nowIso, boundedListLimit(limit, 20))
    .all<RichMenuScheduleRow>();
  return result.results ?? [];
}

/** 期間モードで終了時刻を過ぎた公開中予約。元メニューへ戻す対象。 */
export async function getDueRichMenuScheduleRestores(
  db: D1Database,
  nowIso: string,
  limit = 20,
): Promise<RichMenuScheduleRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM rich_menu_schedules
        WHERE status = 'published'
          AND mode = 'period'
          AND ends_at IS NOT NULL
          AND ends_at <= ?
          AND (next_retry_at IS NULL OR next_retry_at <= ?)
        ORDER BY ends_at ASC LIMIT ?`,
    )
    .bind(nowIso, nowIso, boundedListLimit(limit, 20))
    .all<RichMenuScheduleRow>();
  return result.results ?? [];
}

/**
 * 二重実行を防ぐための排他取得。同じ行を2つのcronが掴んでも、
 * status='scheduled' の1行だけが publishing へ変わる。
 */
export async function claimRichMenuSchedule(
  db: D1Database,
  id: string,
  accountId: string,
  runId: string,
  nowIso: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE rich_menu_schedules
          SET status = 'publishing', started_run_id = ?, updated_at = ?,
              attempt_count = attempt_count + 1
        WHERE id = ? AND account_id = ? AND status = 'scheduled'
          AND starts_at <= ?
          AND (next_retry_at IS NULL OR next_retry_at <= ?)`,
    )
    .bind(runId, jstNow(), id, accountId, nowIso, nowIso)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function claimRichMenuScheduleRestore(
  db: D1Database,
  id: string,
  accountId: string,
  runId: string,
): Promise<boolean> {
  // started_run_idは開始runのまま残し、復元runはended_run_idへ書く。
  // 開始runと復元runを別々に追跡するため。
  const result = await db
    .prepare(
      `UPDATE rich_menu_schedules
          SET status = 'restoring', ended_run_id = ?, updated_at = ?,
              attempt_count = attempt_count + 1
        WHERE id = ? AND account_id = ? AND status = 'published'`,
    )
    .bind(runId, jstNow(), id, accountId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function recordRichMenuScheduleSuccess(
  db: D1Database,
  id: string,
  accountId: string,
  runId: string,
  nextStatus: 'completed' | 'published',
): Promise<void> {
  if (nextStatus === 'published') {
    // 期間モードの開始成功。復元の再試行回数を開始と独立させるため
    // attempt_countを0へ戻す。started_run_idは開始runのまま残し、
    // ended_run_idは復元が終わるまで空けておく。
    await db
      .prepare(
        `UPDATE rich_menu_schedules
            SET status = 'published', ended_run_id = NULL, last_error_code = NULL,
                attempt_count = 0, next_retry_at = NULL, updated_at = ?
          WHERE id = ? AND account_id = ?`,
      )
      .bind(jstNow(), id, accountId)
      .run();
    return;
  }
  await db
    .prepare(
      `UPDATE rich_menu_schedules
          SET status = ?, ended_run_id = ?, last_error_code = NULL,
              next_retry_at = NULL, updated_at = ?
        WHERE id = ? AND account_id = ?`,
    )
    .bind(nextStatus, runId, jstNow(), id, accountId)
    .run();
}

export async function recordRichMenuScheduleRestoreSuccess(
  db: D1Database,
  id: string,
  accountId: string,
  runId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_schedules
          SET status = 'completed', ended_run_id = ?, last_error_code = NULL,
              next_retry_at = NULL, updated_at = ?
        WHERE id = ? AND account_id = ?`,
    )
    .bind(runId, jstNow(), id, accountId)
    .run();
}

export async function recordRichMenuScheduleTransientFailure(
  db: D1Database,
  id: string,
  accountId: string,
  errorCode: string,
  nextRetryAt: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_schedules
          SET status = 'scheduled', last_error_code = ?, next_retry_at = ?,
              updated_at = ?
        WHERE id = ? AND account_id = ?`,
    )
    .bind(errorCode.slice(0, 120), nextRetryAt, jstNow(), id, accountId)
    .run();
}

export async function recordRichMenuScheduleRestoreTransientFailure(
  db: D1Database,
  id: string,
  accountId: string,
  errorCode: string,
  nextRetryAt: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_schedules
          SET status = 'published', last_error_code = ?, next_retry_at = ?,
              updated_at = ?
        WHERE id = ? AND account_id = ?`,
    )
    .bind(errorCode.slice(0, 120), nextRetryAt, jstNow(), id, accountId)
    .run();
}

export async function recordRichMenuSchedulePermanentFailure(
  db: D1Database,
  id: string,
  accountId: string,
  runId: string,
  errorCode: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_schedules
          SET status = 'failed', ended_run_id = ?, last_error_code = ?,
              next_retry_at = NULL, updated_at = ?
        WHERE id = ? AND account_id = ?`,
    )
    .bind(runId, errorCode.slice(0, 120), jstNow(), id, accountId)
    .run();
}

/**
 * claim後に止まった行を拾う。updated_atはjstNow形式(+09:00)でそろっているため
 * 同じ形式のstaleBeforeと文字列比較できる。取得と回収は別にし、回収は
 * 条件付きUPDATEで二重実行しない。
 */
export async function getStalePublishingSchedules(
  db: D1Database,
  staleBeforeJst: string,
  limit = 20,
): Promise<RichMenuScheduleRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM rich_menu_schedules
        WHERE status = 'publishing' AND updated_at <= ?
        ORDER BY updated_at ASC LIMIT ?`,
    )
    .bind(staleBeforeJst, boundedListLimit(limit, 20))
    .all<RichMenuScheduleRow>();
  return result.results ?? [];
}

export async function getStaleRestoringSchedules(
  db: D1Database,
  staleBeforeJst: string,
  limit = 20,
): Promise<RichMenuScheduleRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM rich_menu_schedules
        WHERE status = 'restoring' AND updated_at <= ?
        ORDER BY updated_at ASC LIMIT ?`,
    )
    .bind(staleBeforeJst, boundedListLimit(limit, 20))
    .all<RichMenuScheduleRow>();
  return result.results ?? [];
}

/** staleなpublishingをscheduledへ戻す。古いclaimのままなら1行だけ戻る。 */
export async function reclaimStalePublishingSchedule(
  db: D1Database,
  id: string,
  accountId: string,
  staleBeforeJst: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE rich_menu_schedules
          SET status = 'scheduled', updated_at = ?
        WHERE id = ? AND account_id = ? AND status = 'publishing'
          AND updated_at <= ?`,
    )
    .bind(jstNow(), id, accountId, staleBeforeJst)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** staleなrestoringをpublishedへ戻す。古いclaimのままなら1行だけ戻る。 */
export async function reclaimStaleRestoringSchedule(
  db: D1Database,
  id: string,
  accountId: string,
  staleBeforeJst: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE rich_menu_schedules
          SET status = 'published', updated_at = ?
        WHERE id = ? AND account_id = ? AND status = 'restoring'
          AND updated_at <= ?`,
    )
    .bind(jstNow(), id, accountId, staleBeforeJst)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * 「前のメニューに戻す」(restoreGroupId=null)の予約時点の戻し先を確定する。
 * 同じアカウントで予約対象以外の公開中メニューを新しい順に1件返す。
 * 無ければnullで、終了時はデフォルト解除として扱う。
 */
export async function findPublishedRestoreCandidate(
  db: D1Database,
  accountId: string,
  excludeGroupId: string,
): Promise<{ id: string } | null> {
  const row = await db
    .prepare(
      `SELECT id FROM rich_menu_groups
        WHERE account_id = ? AND id != ? AND status = 'published'
        ORDER BY updated_at DESC LIMIT 1`,
    )
    .bind(accountId, excludeGroupId)
    .first<{ id: string }>();
  return row ?? null;
}

/** 実行前の取消だけ受け付ける。publishing/restoring の最中は 409 側で止める。 */
export async function cancelRichMenuSchedule(
  db: D1Database,
  id: string,
  groupId: string,
  accountId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE rich_menu_schedules
          SET status = 'cancelled', next_retry_at = NULL, updated_at = ?
        WHERE id = ? AND group_id = ? AND account_id = ? AND status = 'scheduled'`,
    )
    .bind(jstNow(), id, groupId, accountId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
