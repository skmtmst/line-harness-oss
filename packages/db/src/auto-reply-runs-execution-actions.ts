import { jstNow } from './utils.js';
import { type AutoReplyActionRunRow, type RecomputedAutoReplyOutcome, type AutoReplyEvaluationStatus } from './auto-reply-runs-types.js';
import { getAutoReplyEvaluationById } from './auto-reply-runs-execution-evaluations.js';


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
       VALUES (?, ?, ?, 1, ?, ?, ?, 'queued', ?, ?)`,
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
  if ((inserted.meta?.changes ?? 0) !== 1 || row.status !== 'queued') {
    return { id: row.id, acquired: false };
  }
  const claimed = await db
    .prepare(
      `UPDATE auto_reply_action_runs
          SET status = 'claimed', attempt_count = attempt_count + 1,
              started_at = ?, updated_at = ?
        WHERE id = ? AND status = 'queued'`,
    )
    .bind(now, now, row.id)
    .run();
  return { id: row.id, acquired: (claimed.meta?.changes ?? 0) === 1 };
}

export async function finishAutoReplyActionRun(
  db: D1Database,
  input: {
    id: string;
    status: 'succeeded' | 'skipped' | 'permanent_failed';
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

/** 評価に紐づく処理行を、実行した順に全部返す。 */
export async function listAutoReplyActionRuns(
  db: D1Database,
  evaluationId: string,
): Promise<AutoReplyActionRunRow[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM auto_reply_action_runs
        WHERE evaluation_id = ?
        ORDER BY created_at ASC, id ASC`,
    )
    .bind(evaluationId)
    .all<AutoReplyActionRunRow>();
  return rows.results;
}

/**
 * 再実行の入口。評価を actions_running へ進める条件付きUPDATE。
 *
 * permanent_failed の処理行が残る終了済みの評価だけ通す。同時に2本
 * 来ても、このUPDATEを通れた側だけが先へ進める（負けた側は409）。
 * 途中で止まった再実行（actions_running のまま失敗行が残り、確保済み
 * の行が無い）は「生きている再実行ではない」とみなしてもう一度入れる。
 */
export async function claimAutoReplyEvaluationForRetry(
  db: D1Database,
  evaluationId: string,
): Promise<boolean> {
  const claimed = await db
    .prepare(
      `UPDATE auto_reply_evaluations
          SET status = 'actions_running', updated_at = ?
        WHERE id = ?
          AND EXISTS (
            SELECT 1 FROM auto_reply_action_runs
             WHERE evaluation_id = auto_reply_evaluations.id
               AND status = 'permanent_failed'
          )
          AND (
            status IN ('reply_failed', 'partial_failed', 'failed')
            OR (
              status = 'actions_running'
              AND NOT EXISTS (
                SELECT 1 FROM auto_reply_action_runs
                 WHERE evaluation_id = auto_reply_evaluations.id
                   AND status IN ('queued', 'claimed')
              )
            )
          )`,
    )
    .bind(jstNow(), evaluationId)
    .run();
  return (claimed.meta?.changes ?? 0) === 1;
}

export async function claimPermanentFailedAutoReplyActionRuns(
  db: D1Database,
  evaluationId: string,
): Promise<AutoReplyActionRunRow[]> {
  const now = jstNow();
  // SELECT→行ごとのUPDATEに分けると、文の合間に別リクエストが残り行を
  // 取って両方が副作用を起こす。1文のUPDATEで失敗行をまとめて取る。
  const rows = await db
    .prepare(
      `UPDATE auto_reply_action_runs
          SET status = 'claimed', attempt_count = attempt_count + 1,
              started_at = ?, completed_at = NULL, updated_at = ?
        WHERE evaluation_id = ? AND status = 'permanent_failed'
        RETURNING *`,
    )
    .bind(now, now, evaluationId)
    .all<AutoReplyActionRunRow>();
  return rows.results;
}

export const ACTION_SUMMARY_KEYS = [
  'executed',
  'skippedByCondition',
  'skippedByOnce',
  'failed',
  'skippedIncomplete',
] as const;

/**
 * 評価の action_summary と status を、紐づく処理行の現在地から計算し直す。
 *
 * 再実行のあとに呼ぶ。reply_status / line_request_id / message_log_id は
 * LINE への返信を送り直さないので一切触らない。処理が全部終わり
 * （succeeded / skipped）なら、返信が通った評価は completed、返信だけ
 * 失敗している評価は reply_failed のままにする。失敗や処理中の行が
 * 残れば partial_failed。
 */
export async function recomputeAutoReplyEvaluationFromActions(
  db: D1Database,
  evaluationId: string,
): Promise<RecomputedAutoReplyOutcome | null> {
  const evaluation = await getAutoReplyEvaluationById(db, evaluationId);
  if (!evaluation) return null;
  const runs = await listAutoReplyActionRuns(db, evaluationId);

  const summary: Record<(typeof ACTION_SUMMARY_KEYS)[number], number> = {
    executed: 0,
    skippedByCondition: 0,
    skippedByOnce: 0,
    failed: 0,
    skippedIncomplete: 0,
  };
  let allSettled = true;
  for (const run of runs) {
    if (run.status !== 'succeeded' && run.status !== 'skipped') allSettled = false;
    let counted = false;
    if (run.result_json) {
      try {
        const result = JSON.parse(run.result_json) as Record<string, unknown>;
        for (const key of ACTION_SUMMARY_KEYS) {
          const value = result[key];
          if (typeof value === 'number' && Number.isFinite(value)) summary[key] += value;
        }
        counted = true;
      } catch {
        counted = false;
      }
    }
    if (!counted) {
      // result_json の無い行は状態から桶へ振り分ける。
      // 確保されたまま終わっていない行も「失敗」側に数え、見逃さない。
      if (run.status === 'succeeded') summary.executed += 1;
      else if (run.status === 'skipped') summary.skippedByCondition += 1;
      else summary.failed += 1;
    }
  }

  const status: AutoReplyEvaluationStatus = !allSettled
    ? 'partial_failed'
    : evaluation.reply_status === 'failed'
      ? 'reply_failed'
      : 'completed';
  // 返信失敗のまま残る評価は、返信の失敗理由（error_code）を消さない。
  const errorCode = status === 'partial_failed'
    ? 'action_failed'
    : status === 'reply_failed'
      ? evaluation.error_code
      : null;
  const now = jstNow();
  await db
    .prepare(
      `UPDATE auto_reply_evaluations
          SET status = ?, action_summary = ?, error_code = ?, completed_at = ?,
              duration_ms = MAX(0, CAST((julianday(?) - julianday(evaluated_at)) * 86400000 AS INTEGER)),
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(status, JSON.stringify(summary), errorCode, now, now, now, evaluationId)
    .run();
  return { status, actionSummary: summary };
}
