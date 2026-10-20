import { jstNow } from './utils.js';
import { type AutoReplyEvaluationRow } from './auto-reply-runs-types.js';



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

export async function getAutoReplyEvaluationById(
  db: D1Database,
  evaluationId: string,
): Promise<AutoReplyEvaluationRow | null> {
  return db
    .prepare(`SELECT * FROM auto_reply_evaluations WHERE id = ?`)
    .bind(evaluationId)
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
