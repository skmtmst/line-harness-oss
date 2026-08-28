import type { AutoReply } from './auto-replies.js';
import { jstNow } from './utils.js';

export type AutoReplyEvaluationStatus =
  | 'received'
  | 'evaluated'
  | 'matched'
  | 'skipped'
  | 'reply_accepted'
  | 'reply_failed'
  | 'actions_running'
  | 'completed'
  | 'partial_failed'
  | 'failed';

export interface AutoReplyVersionRow {
  id: string;
  auto_reply_id: string;
  version_number: number;
  line_account_id: string | null;
  definition_snapshot: string;
  status: 'draft' | 'published' | 'retired';
  published_at: string | null;
  published_by_staff_id: string | null;
  created_at: string;
}

export interface AutoReplyEvaluationRow {
  id: string;
  incoming_event_id: string;
  incoming_message_log_id: string | null;
  line_account_id: string | null;
  friend_id: string;
  message_kind: string;
  normalized_text_hash: string;
  input_preview_masked: string | null;
  evaluated_at: string;
  completed_at: string | null;
  winning_auto_reply_id: string | null;
  winning_version_id: string | null;
  status: AutoReplyEvaluationStatus;
  skip_reason: string | null;
  matched_keyword: string | null;
  reply_status: 'not_attempted' | 'accepted' | 'failed';
  line_request_id: string | null;
  message_log_id: string | null;
  action_summary: string | null;
  error_code: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * 版の比較に使う定義。画面の表示名も含め、実行時の意味が変わる項目だけを固定する。
 * プロパティ順は変えない。JSON文字列を版の同一判定に使うため。
 */
export function autoReplyDefinitionSnapshot(rule: AutoReply): string {
  return JSON.stringify({
    keyword: rule.keyword,
    matchType: rule.match_type,
    responseType: rule.response_type,
    responseContent: rule.response_content,
    templateId: rule.template_id,
    lineAccountId: rule.line_account_id,
    activeFrom: rule.active_from,
    activeUntil: rule.active_until,
    cooldownMinutes: rule.cooldown_minutes,
    skipWhenOperatorActive: rule.skip_when_operator_active === 1,
    priority: rule.priority,
    messageKinds: rule.message_kinds_json,
    friendConditions: rule.friend_conditions_json,
    actions: rule.actions_json,
    responseWeekdays: rule.response_weekdays_json,
    responseHolidayRule: rule.response_holiday_rule,
    oncePerFriend: rule.once_per_friend === 1,
    keywords: rule.keywords_json,
    respondToAll: rule.respond_to_all === 1,
    name: rule.name,
    keywordMatchMode: rule.keyword_match_mode,
  });
}

/** 実行時の定義を不変の版として確保する。既存UIの保存形式は変えない。 */
export async function ensureAutoReplyPublishedVersion(
  db: D1Database,
  rule: AutoReply,
): Promise<AutoReplyVersionRow> {
  const snapshot = autoReplyDefinitionSnapshot(rule);
  const latest = await db
    .prepare(
      `SELECT * FROM auto_reply_versions
        WHERE auto_reply_id = ?
        ORDER BY version_number DESC LIMIT 1`,
    )
    .bind(rule.id)
    .first<AutoReplyVersionRow>();
  if (latest?.definition_snapshot === snapshot) return latest;

  const versionNumber = Number(latest?.version_number ?? 0) + 1;
  const now = jstNow();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT OR IGNORE INTO auto_reply_versions
         (id, auto_reply_id, version_number, line_account_id, definition_snapshot,
          status, published_at, published_by_staff_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'published', ?, NULL, ?)`,
    )
    .bind(id, rule.id, versionNumber, rule.line_account_id, snapshot, now, now)
    .run();

  const saved = await db
    .prepare(
      `SELECT * FROM auto_reply_versions
        WHERE auto_reply_id = ?
        ORDER BY version_number DESC LIMIT 1`,
    )
    .bind(rule.id)
    .first<AutoReplyVersionRow>();
  if (!saved) throw new Error('auto_reply_version_not_saved');
  return saved;
}

export async function reserveAutoReplyEvaluation(
  db: D1Database,
  input: {
    incomingEventId: string;
    incomingMessageLogId?: string | null;
    lineAccountId?: string | null;
    friendId: string;
    messageKind: string;
    normalizedTextHash: string;
    inputPreviewMasked?: string | null;
    occurredAt: string;
  },
): Promise<{ created: boolean; row: AutoReplyEvaluationRow }> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO auto_reply_evaluations
         (id, incoming_event_id, incoming_message_log_id, line_account_id, friend_id,
          message_kind, normalized_text_hash, input_preview_masked, evaluated_at,
          status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)`,
    )
    .bind(
      id,
      input.incomingEventId,
      input.incomingMessageLogId ?? null,
      input.lineAccountId ?? null,
      input.friendId,
      input.messageKind,
      input.normalizedTextHash,
      input.inputPreviewMasked ?? null,
      input.occurredAt,
      now,
      now,
    )
    .run();
  const row = await getAutoReplyEvaluationByEventId(db, input.incomingEventId);
  if (!row) throw new Error('auto_reply_evaluation_not_reserved');
  return { created: (result.meta?.changes ?? 0) === 1, row };
}

export async function getAutoReplyEvaluationByEventId(
  db: D1Database,
  incomingEventId: string,
): Promise<AutoReplyEvaluationRow | null> {
  return db
    .prepare(`SELECT * FROM auto_reply_evaluations WHERE incoming_event_id = ?`)
    .bind(incomingEventId)
    .first<AutoReplyEvaluationRow>();
}

export async function recordAutoReplyEvaluationDetail(
  db: D1Database,
  input: {
    evaluationId: string;
    autoReplyId: string;
    ruleVersionId?: string | null;
    order: number;
    result: 'not_matched' | 'skipped' | 'won';
    reasonCodes: string[];
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO auto_reply_evaluation_details
         (id, evaluation_id, auto_reply_id, rule_version_id, evaluation_order,
          result, reason_codes_json, created_at)
       VALUES (
         COALESCE((SELECT id FROM auto_reply_evaluation_details
                    WHERE evaluation_id = ? AND auto_reply_id = ?), ?),
         ?, ?, ?, ?, ?, ?, ?
       )`,
    )
    .bind(
      input.evaluationId,
      input.autoReplyId,
      crypto.randomUUID(),
      input.evaluationId,
      input.autoReplyId,
      input.ruleVersionId ?? null,
      input.order,
      input.result,
      JSON.stringify(input.reasonCodes),
      jstNow(),
    )
    .run();
}

export async function markAutoReplyEvaluationMatched(
  db: D1Database,
  input: {
    evaluationId: string;
    autoReplyId: string;
    versionId: string;
    matchedKeyword: string;
  },
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE auto_reply_evaluations
          SET winning_auto_reply_id = ?, winning_version_id = ?, matched_keyword = ?,
              status = 'matched', updated_at = ?
        WHERE id = ?`,
    )
    .bind(input.autoReplyId, input.versionId, input.matchedKeyword, now, input.evaluationId)
    .run();
}

export async function markAutoReplyEvaluationSkipped(
  db: D1Database,
  evaluationId: string,
  reason: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE auto_reply_evaluations
          SET status = 'skipped', skip_reason = ?, completed_at = ?,
              duration_ms = MAX(0, CAST((julianday(?) - julianday(evaluated_at)) * 86400000 AS INTEGER)),
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(reason, now, now, now, evaluationId)
    .run();
}

export async function markAutoReplyEvaluationFinished(
  db: D1Database,
  input: {
    evaluationId: string;
    status: 'completed' | 'partial_failed' | 'reply_failed' | 'failed';
    replyStatus: 'not_attempted' | 'accepted' | 'failed';
    lineRequestId?: string | null;
    messageLogId?: string | null;
    actionSummary: Record<string, number>;
    errorCode?: string | null;
  },
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE auto_reply_evaluations
          SET status = ?, reply_status = ?, line_request_id = ?, message_log_id = ?,
              action_summary = ?, error_code = ?, completed_at = ?,
              duration_ms = MAX(0, CAST((julianday(?) - julianday(evaluated_at)) * 86400000 AS INTEGER)),
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      input.status,
      input.replyStatus,
      input.lineRequestId ?? null,
      input.messageLogId ?? null,
      JSON.stringify(input.actionSummary),
      input.errorCode ?? null,
      now,
      now,
      now,
      input.evaluationId,
    )
    .run();
}

export async function reserveAutoReplyActionRun(
  db: D1Database,
  input: {
    evaluationId: string;
    actionStableId: string;
    actionType: string;
    actionSnapshot: string;
    idempotencyKey: string;
  },
): Promise<{ id: string; acquired: boolean }> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO auto_reply_action_runs
         (id, evaluation_id, action_stable_id, action_version, action_type,
          action_snapshot, idempotency_key, status, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      id,
      input.evaluationId,
      input.actionStableId,
      input.actionType,
      input.actionSnapshot,
      input.idempotencyKey,
      now,
      now,
    )
    .run();
  const row = await db
    .prepare(
      `SELECT id, status FROM auto_reply_action_runs
        WHERE evaluation_id = ? AND action_stable_id = ?`,
    )
    .bind(input.evaluationId, input.actionStableId)
    .first<{ id: string; status: string }>();
  if (!row) throw new Error('auto_reply_action_run_not_reserved');
  if ((inserted.meta?.changes ?? 0) !== 1 || row.status !== 'pending') {
    return { id: row.id, acquired: false };
  }
  const claimed = await db
    .prepare(
      `UPDATE auto_reply_action_runs
          SET status = 'running', attempt_count = attempt_count + 1,
              started_at = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'`,
    )
    .bind(now, now, row.id)
    .run();
  return { id: row.id, acquired: (claimed.meta?.changes ?? 0) === 1 };
}

export async function finishAutoReplyActionRun(
  db: D1Database,
  input: {
    id: string;
    status: 'succeeded' | 'skipped' | 'failed';
    errorCode?: string | null;
    result?: Record<string, unknown>;
  },
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE auto_reply_action_runs
          SET status = ?, last_error_code = ?, result_json = ?,
              completed_at = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      input.status,
      input.errorCode ?? null,
      input.result ? JSON.stringify(input.result) : null,
      now,
      now,
      input.id,
    )
    .run();
}

export interface AutoReplyRunListRow extends AutoReplyEvaluationRow {
  friend_name: string | null;
  account_label: string | null;
  rule_name: string | null;
  rule_keyword: string | null;
  rule_priority: number | null;
  version_number: number | null;
  candidate_result: 'not_matched' | 'skipped' | 'won' | null;
  candidate_reason_codes: string | null;
}

function visibleAccountClause(input: {
  lineAccountIds: string[];
  includeUnassigned: boolean;
}): { sql: string; bindings: string[] } {
  const pieces: string[] = [];
  const bindings: string[] = [];
  if (input.lineAccountIds.length > 0) {
    pieces.push(`are.line_account_id IN (${input.lineAccountIds.map(() => '?').join(', ')})`);
    bindings.push(...input.lineAccountIds);
  }
  if (input.includeUnassigned) pieces.push('are.line_account_id IS NULL');
  return { sql: pieces.length > 0 ? `(${pieces.join(' OR ')})` : '0 = 1', bindings };
}

function evaluationFilters(input: {
  ruleId?: string;
  status?: AutoReplyEvaluationStatus;
  search?: string;
  lineAccountIds: string[];
  includeUnassigned: boolean;
  includeCandidateSkips?: boolean;
}): { where: string; bindings: Array<string | number> } {
  const visible = visibleAccountClause(input);
  const clauses = [visible.sql];
  const bindings: Array<string | number> = [...visible.bindings];
  if (input.ruleId) {
    if (input.includeCandidateSkips) {
      clauses.push(`(
        are.winning_auto_reply_id = ?
        OR EXISTS (
          SELECT 1 FROM auto_reply_evaluation_details detail
           WHERE detail.evaluation_id = are.id
             AND detail.auto_reply_id = ?
             AND detail.result = 'skipped'
        )
      )`);
      bindings.push(input.ruleId, input.ruleId);
    } else {
      clauses.push('are.winning_auto_reply_id = ?');
      bindings.push(input.ruleId);
    }
  }
  if (input.status) {
    clauses.push('are.status = ?');
    bindings.push(input.status);
  }
  if (input.search) {
    clauses.push(`(COALESCE(f.display_name, '') LIKE ? OR COALESCE(are.input_preview_masked, '') LIKE ?)`);
    const q = `%${input.search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    bindings.push(q, q);
  }
  return { where: clauses.join(' AND '), bindings };
}

export async function listAutoReplyEvaluationRuns(
  db: D1Database,
  input: {
    ruleId?: string;
    status?: AutoReplyEvaluationStatus;
    search?: string;
    lineAccountIds: string[];
    includeUnassigned: boolean;
    limit: number;
    offset: number;
  },
): Promise<{ items: AutoReplyRunListRow[]; total: number }> {
  const filter = evaluationFilters({ ...input, includeCandidateSkips: true });
  const join = `FROM auto_reply_evaluations are
    LEFT JOIN friends f ON f.id = are.friend_id
    LEFT JOIN line_accounts la ON la.id = are.line_account_id
    LEFT JOIN auto_replies ar ON ar.id = are.winning_auto_reply_id
    LEFT JOIN auto_reply_versions arv ON arv.id = are.winning_version_id`;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total ${join} WHERE ${filter.where}`)
    .bind(...filter.bindings)
    .first<{ total: number }>();
  const rows = await db
    .prepare(
      `SELECT are.*, f.display_name AS friend_name, la.name AS account_label,
              ar.name AS rule_name, ar.keyword AS rule_keyword, ar.priority AS rule_priority,
              arv.version_number AS version_number,
              ${input.ruleId
                ? `(SELECT detail.result
                      FROM auto_reply_evaluation_details detail
                     WHERE detail.evaluation_id = are.id AND detail.auto_reply_id = ?
                     LIMIT 1)`
                : 'NULL'} AS candidate_result,
              ${input.ruleId
                ? `(SELECT detail.reason_codes_json
                      FROM auto_reply_evaluation_details detail
                     WHERE detail.evaluation_id = are.id AND detail.auto_reply_id = ?
                     LIMIT 1)`
                : 'NULL'} AS candidate_reason_codes
         ${join}
        WHERE ${filter.where}
        ORDER BY are.evaluated_at DESC, are.id DESC
        LIMIT ? OFFSET ?`,
    )
    .bind(...(input.ruleId ? [input.ruleId, input.ruleId] : []), ...filter.bindings, input.limit, input.offset)
    .all<AutoReplyRunListRow>();
  return { items: rows.results, total: Number(count?.total ?? 0) };
}

export interface AutoReplyRunSummary {
  monthHits: number;
  totalHits: number;
  handovers: number;
  errors: number;
  lastRunAt: string | null;
  averageResponseMs: number | null;
  handoverWaiting: number;
  handoverInProgress: number;
  handoverCompleted: number;
}

export async function getAutoReplyEvaluationSummary(
  db: D1Database,
  input: {
    ruleId?: string;
    lineAccountIds: string[];
    includeUnassigned: boolean;
    monthFrom: string;
    monthTo: string;
  },
): Promise<AutoReplyRunSummary> {
  const filter = evaluationFilters({ ...input });
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN are.winning_auto_reply_id IS NOT NULL
                    AND are.evaluated_at >= ? AND are.evaluated_at < ? THEN 1 ELSE 0 END) AS month_hits,
         SUM(CASE WHEN are.winning_auto_reply_id IS NOT NULL THEN 1 ELSE 0 END) AS total_hits,
         SUM(CASE WHEN are.status IN ('reply_failed', 'partial_failed', 'failed') THEN 1 ELSE 0 END) AS errors,
         MAX(CASE WHEN are.winning_auto_reply_id IS NOT NULL THEN are.evaluated_at END) AS last_run_at,
         AVG(CASE WHEN are.winning_auto_reply_id IS NOT NULL THEN are.duration_ms END) AS average_response_ms
       FROM auto_reply_evaluations are
       LEFT JOIN friends f ON f.id = are.friend_id
       WHERE ${filter.where}`,
    )
    .bind(input.monthFrom, input.monthTo, ...filter.bindings)
    .first<{
      month_hits: number | null;
      total_hits: number | null;
      errors: number | null;
      last_run_at: string | null;
      average_response_ms: number | null;
    }>();

  const handover = await db
    .prepare(
      `SELECT
         COUNT(DISTINCT are.id) AS total,
         COUNT(DISTINCT CASE WHEN c.status IN ('unread', 'on_hold') THEN are.id END) AS waiting,
         COUNT(DISTINCT CASE WHEN c.status = 'in_progress' THEN are.id END) AS in_progress,
         COUNT(DISTINCT CASE WHEN c.status = 'resolved' THEN are.id END) AS completed
       FROM auto_reply_evaluations are
       INNER JOIN auto_reply_action_runs arr
               ON arr.evaluation_id = are.id
              AND arr.action_type = 'support_mark'
              AND arr.status = 'succeeded'
       LEFT JOIN chats c ON c.friend_id = are.friend_id
       LEFT JOIN friends f ON f.id = are.friend_id
       WHERE ${filter.where}`,
    )
    .bind(...filter.bindings)
    .first<{ total: number; waiting: number; in_progress: number; completed: number }>();

  return {
    monthHits: Number(row?.month_hits ?? 0),
    totalHits: Number(row?.total_hits ?? 0),
    handovers: Number(handover?.total ?? 0),
    errors: Number(row?.errors ?? 0),
    lastRunAt: row?.last_run_at ?? null,
    averageResponseMs: row?.average_response_ms == null
      ? null
      : Math.max(0, Math.round(Number(row.average_response_ms))),
    handoverWaiting: Number(handover?.waiting ?? 0),
    handoverInProgress: Number(handover?.in_progress ?? 0),
    handoverCompleted: Number(handover?.completed ?? 0),
  };
}

export async function getAutoReplyTriggerBreakdown(
  db: D1Database,
  input: {
    ruleId?: string;
    lineAccountIds: string[];
    includeUnassigned: boolean;
    limit?: number;
  },
): Promise<Array<{ trigger: string; count: number }>> {
  const filter = evaluationFilters({ ...input });
  const rows = await db
    .prepare(
      `SELECT COALESCE(NULLIF(are.matched_keyword, ''), 'すべてのメッセージ') AS trigger,
              COUNT(*) AS count
         FROM auto_reply_evaluations are
         LEFT JOIN friends f ON f.id = are.friend_id
        WHERE ${filter.where} AND are.winning_auto_reply_id IS NOT NULL
        GROUP BY trigger
        ORDER BY count DESC, trigger ASC
        LIMIT ?`,
    )
    .bind(...filter.bindings, input.limit ?? 10)
    .all<{ trigger: string; count: number }>();
  return rows.results.map((row) => ({ trigger: row.trigger, count: Number(row.count) }));
}
