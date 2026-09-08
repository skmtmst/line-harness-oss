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

export async function getRichMenuScheduleById(
  db: D1Database,
  id: string,
  accountId: string,
): Promise<RichMenuScheduleRow | null> {
  const row = await db
    .prepare(`SELECT * FROM rich_menu_schedules WHERE id = ? AND account_id = ?`)
    .bind(id, accountId)
    .first<RichMenuScheduleRow>();
  return row ?? null;
}

/**
 * 成功記録は lease fencing 付き。claimしたrunだけが書ける。
 * staleなrun Aがrun Bのclaim後に書こうとしても changes=0 で失敗し false を返す。
 */
export async function recordRichMenuScheduleSuccess(
  db: D1Database,
  id: string,
  accountId: string,
  runId: string,
  nextStatus: 'completed' | 'published',
): Promise<boolean> {
  if (nextStatus === 'published') {
    // 期間モードの開始成功。復元の再試行回数を開始と独立させるため
    // attempt_countを0へ戻す。started_run_idは開始runのまま残し、
    // ended_run_idは復元が終わるまで空けておく。
    const result = await db
      .prepare(
        `UPDATE rich_menu_schedules
            SET status = 'published', ended_run_id = NULL, last_error_code = NULL,
                attempt_count = 0, next_retry_at = NULL, updated_at = ?
          WHERE id = ? AND account_id = ? AND status = 'publishing'
            AND started_run_id = ?`,
      )
      .bind(jstNow(), id, accountId, runId)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }
  const result = await db
    .prepare(
      `UPDATE rich_menu_schedules
          SET status = ?, ended_run_id = ?, last_error_code = NULL,
              next_retry_at = NULL, updated_at = ?
        WHERE id = ? AND account_id = ? AND status = 'publishing'
          AND started_run_id = ?`,
    )
    .bind(nextStatus, runId, jstNow(), id, accountId, runId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function recordRichMenuScheduleRestoreSuccess(
  db: D1Database,
  id: string,
  accountId: string,
  runId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE rich_menu_schedules
          SET status = 'completed', ended_run_id = ?, last_error_code = NULL,
              next_retry_at = NULL, updated_at = ?
        WHERE id = ? AND account_id = ? AND status = 'restoring'
          AND ended_run_id = ?`,
    )
    .bind(runId, jstNow(), id, accountId, runId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function recordRichMenuScheduleTransientFailure(
  db: D1Database,
  id: string,
  accountId: string,
  runId: string,
  errorCode: string,
  nextRetryAt: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE rich_menu_schedules
          SET status = 'scheduled', last_error_code = ?, next_retry_at = ?,
              updated_at = ?
        WHERE id = ? AND account_id = ? AND status = 'publishing'
          AND started_run_id = ?`,
    )
    .bind(errorCode.slice(0, 120), nextRetryAt, jstNow(), id, accountId, runId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function recordRichMenuScheduleRestoreTransientFailure(
  db: D1Database,
  id: string,
  accountId: string,
  runId: string,
  errorCode: string,
  nextRetryAt: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE rich_menu_schedules
          SET status = 'published', last_error_code = ?, next_retry_at = ?,
              updated_at = ?
        WHERE id = ? AND account_id = ? AND status = 'restoring'
          AND ended_run_id = ?`,
    )
    .bind(errorCode.slice(0, 120), nextRetryAt, jstNow(), id, accountId, runId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function recordRichMenuSchedulePermanentFailure(
  db: D1Database,
  id: string,
  accountId: string,
  runId: string,
  errorCode: string,
): Promise<boolean> {
  // 恒久失敗もlease付き。stale runが新しいclaimをfailedで潰さない。
  // 開始側(publishing/scheduled)か復元側(restoring/published)のどちらかで
  // 自分のrunが残っている場合だけ書ける。
  const result = await db
    .prepare(
      `UPDATE rich_menu_schedules
          SET status = 'failed', ended_run_id = ?, last_error_code = ?,
              next_retry_at = NULL, updated_at = ?
        WHERE id = ? AND account_id = ?
          AND (started_run_id = ? OR ended_run_id = ?)`,
    )
    .bind(runId, errorCode.slice(0, 120), jstNow(), id, accountId, runId, runId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
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

export type SchedulePublicationKind = 'publish' | 'restore';

export type SchedulePublicationRow = {
  schedule_id: string;
  kind: SchedulePublicationKind;
  page_id: string;
  line_richmenu_id: string;
  run_id: string;
  created_at: string;
};

/**
 * 外部LINEへの作成結果をdurableに残す。LINE成功後・D1記録前の停止で
 * 再実行しても作り直さないための照合元。INSERT OR IGNOREで二重記録しない。
 */
export async function recordSchedulePublications(
  db: D1Database,
  scheduleId: string,
  kind: SchedulePublicationKind,
  runId: string,
  pages: Array<{ pageId: string; lineRichMenuId: string }>,
  createdAt?: string,
): Promise<void> {
  if (pages.length === 0) return;
  const now = createdAt ?? jstNow();
  const stmts = pages.map((page) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO rich_menu_schedule_publications
           (schedule_id, kind, page_id, line_richmenu_id, run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(scheduleId, kind, page.pageId, page.lineRichMenuId, runId, now),
  );
  await db.batch(stmts);
}

export async function getSchedulePublications(
  db: D1Database,
  scheduleId: string,
  kind: SchedulePublicationKind,
): Promise<SchedulePublicationRow[]> {
  const result = await db
    .prepare(
      `SELECT schedule_id, kind, page_id, line_richmenu_id, run_id, created_at
         FROM rich_menu_schedule_publications
        WHERE schedule_id = ? AND kind = ?
        ORDER BY page_id ASC`,
    )
    .bind(scheduleId, kind)
    .all<SchedulePublicationRow>();
  return result.results ?? [];
}

export type CreateScheduleInput = {
  id: string;
  groupId: string;
  accountId: string;
  mode: 'scheduled' | 'period';
  startsAt: string;
  endsAt: string | null;
  restoreGroupId: string | null;
  definitionSnapshot: string;
  idempotencyKey: string;
  requestedByStaffId: string;
  now: string;
};

/**
 * 予約作成を原子的に行う。SELECT→INSERTの2段階にしない。
 * INSERT OR IGNORE相当で競合を吸収し、同keyの既存行と内容を比べる。
 * 同内容なら既存を返し、異内容ならconflictを返す（成功扱いにしない）。
 */
export async function createRichMenuScheduleAtomic(
  db: D1Database,
  input: CreateScheduleInput,
): Promise<
  | { outcome: 'created'; id: string }
  | { outcome: 'existing'; id: string; status: string }
  | { outcome: 'conflict'; id: string; status: string }
> {
  const insert = await db
    .prepare(
      `INSERT INTO rich_menu_schedules
         (id, group_id, account_id, mode, starts_at, ends_at, restore_group_id,
          definition_snapshot, status, idempotency_key, requested_by_staff_id,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)
       ON CONFLICT(account_id, idempotency_key) DO NOTHING`,
    )
    .bind(
      input.id,
      input.groupId,
      input.accountId,
      input.mode,
      input.startsAt,
      input.endsAt,
      input.restoreGroupId,
      input.definitionSnapshot,
      input.idempotencyKey,
      input.requestedByStaffId,
      input.now,
      input.now,
    )
    .run();
  if ((insert.meta?.changes ?? 0) > 0) {
    return { outcome: 'created', id: input.id };
  }
  const existing = await db
    .prepare(
      `SELECT id, status, group_id, mode, starts_at, ends_at, restore_group_id,
              definition_snapshot
         FROM rich_menu_schedules
        WHERE account_id = ? AND idempotency_key = ?`,
    )
    .bind(input.accountId, input.idempotencyKey)
    .first<{
      id: string;
      status: string;
      group_id: string;
      mode: string;
      starts_at: string;
      ends_at: string | null;
      restore_group_id: string | null;
      definition_snapshot: string;
    }>();
  if (!existing) {
    // 同時実行の狭間で消えた等の想定外。再試行させる。
    throw new Error('schedule idempotency race: existing row not found');
  }
  const same =
    existing.group_id === input.groupId &&
    existing.mode === input.mode &&
    existing.starts_at === input.startsAt &&
    (existing.ends_at ?? null) === (input.endsAt ?? null) &&
    (existing.restore_group_id ?? null) === (input.restoreGroupId ?? null) &&
    existing.definition_snapshot === input.definitionSnapshot;
  if (same) {
    return { outcome: 'existing', id: existing.id, status: existing.status };
  }
  return { outcome: 'conflict', id: existing.id, status: existing.status };
}

/** snapshot内のpage id一覧を取り出す。壊れたJSONは空配列。 */
export function snapshotPageIds(snapshot: unknown): string[] {
  if (typeof snapshot !== 'object' || snapshot === null) return [];
  const pages = (snapshot as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return [];
  const ids: string[] = [];
  for (const page of pages) {
    if (page && typeof page === 'object' && typeof (page as { id?: unknown }).id === 'string') {
      ids.push((page as { id: string }).id);
    }
  }
  return ids;
}

/**
 * 予約後の下書き編集・ページ削除のずれを検出する。
 * snapshotにあるpageが現在のgroupに無ければdriftとして恒久失敗させる。
 * 内容の編集自体はsnapshotが正本のため許すが、消えたpageへのID記録はしない。
 */
export function detectSnapshotPageDrift(
  snapshot: unknown,
  currentPageIds: string[],
): string | null {
  const wanted = snapshotPageIds(snapshot);
  if (wanted.length === 0) return 'definition_snapshot has no pages';
  const current = new Set(currentPageIds);
  const missing = wanted.filter((id) => !current.has(id));
  if (missing.length > 0) {
    return `snapshot drift: pages deleted after reservation (${missing.slice(0, 3).join(',')})`;
  }
  return null;
}
