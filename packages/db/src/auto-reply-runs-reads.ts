import { sqlIdSet } from './id-queries.js';
import { type AutoReplyEvaluationStatus, type AutoReplyRunListRow, type AutoReplyRunSummary } from './auto-reply-runs-types.js';


export function visibleAccountClause(input: {
  lineAccountIds: string[];
  includeUnassigned: boolean;
}): { sql: string; bindings: string[] } {
  const pieces: string[] = [];
  const bindings: string[] = [];
  if (input.lineAccountIds.length > 0) {
    pieces.push(`are.line_account_id IN (${sqlIdSet(input.lineAccountIds).sql})`);
    bindings.push(...(input.lineAccountIds.length ? sqlIdSet(input.lineAccountIds).binds : []));
  }
  if (input.includeUnassigned) pieces.push('are.line_account_id IS NULL');
  return { sql: pieces.length > 0 ? `(${pieces.join(' OR ')})` : '0 = 1', bindings };
}

export function evaluationFilters(input: {
  ruleId?: string;
  status?: AutoReplyEvaluationStatus;
  search?: string;
  normalizedTextHash?: string;
  lineAccountIds: string[];
  includeUnassigned: boolean;
  from?: string;
  until?: string;
  includeCandidateSkips?: boolean;
}): { where: string; bindings: Array<string | number> } {
  const visible = visibleAccountClause(input);
  const clauses = [visible.sql];
  const bindings: Array<string | number> = [...visible.bindings];
  if (input.from) { clauses.push('julianday(are.evaluated_at) >= julianday(?)'); bindings.push(input.from); }
  if (input.until) { clauses.push('julianday(are.evaluated_at) < julianday(?)'); bindings.push(input.until); }
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
    clauses.push(input.normalizedTextHash
      ? `(COALESCE(f.display_name, '') LIKE ? ESCAPE '\\' OR are.normalized_text_hash = ?)`
      : `COALESCE(f.display_name, '') LIKE ? ESCAPE '\\'`);
    const q = `%${input.search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    bindings.push(q);
    if (input.normalizedTextHash) bindings.push(input.normalizedTextHash);
  }
  return { where: clauses.join(' AND '), bindings };
}

export async function listAutoReplyEvaluationRuns(
  db: D1Database,
  input: {
    ruleId?: string;
    status?: AutoReplyEvaluationStatus;
    search?: string;
    normalizedTextHash?: string;
    lineAccountIds: string[];
    includeUnassigned: boolean;
    from?: string;
    until?: string;
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
                : 'NULL'} AS candidate_reason_codes,
              EXISTS (
                SELECT 1 FROM auto_reply_action_runs failed_run
                 WHERE failed_run.evaluation_id = are.id
                   AND failed_run.status = 'permanent_failed'
              ) AS has_failed_action_run,
              EXISTS (
                SELECT 1 FROM auto_reply_action_runs inflight_run
                 WHERE inflight_run.evaluation_id = are.id
                   AND inflight_run.status IN ('queued', 'claimed')
              ) AS has_inflight_action_run
         ${join}
        WHERE ${filter.where}
        ORDER BY are.evaluated_at DESC, are.id DESC
        LIMIT ? OFFSET ?`,
    )
    .bind(...(input.ruleId ? [input.ruleId, input.ruleId] : []), ...filter.bindings, input.limit, input.offset)
    .all<AutoReplyRunListRow>();
  return { items: rows.results, total: Number(count?.total ?? 0) };
}

export async function getAutoReplyEvaluationSummary(
  db: D1Database,
  input: {
    ruleId?: string;
    lineAccountIds: string[];
    includeUnassigned: boolean;
    from?: string;
    until?: string;
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
    from?: string;
    until?: string;
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
