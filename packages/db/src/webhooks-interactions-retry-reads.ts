import { toJstString } from './utils.js';
import { type WebhookInteractionRow, type OutgoingWebhookDeliverySummaryRow } from './webhooks-types.js';


/*
 * まとめて再送で選ぶ失敗の条件（webhook_interaction_logs を `l` で参照）。
 *
 * 除外するもの:
 *   - 届いたか分からない記録(unknown) … 届いていた処理を二重に送る恐れ(IDEA-26)
 *   - 署名の合言葉が読めなかった記録(secret_unavailable) … 鍵を戻すまで届かない(d23b R415)
 *   - 送り先が消えた・止められた記録 … やり直しても必ず外す(d23b R405)
 *   - 送った内容が残っていない記録 … 同じ出来事を再現できない
 *   - 自動の送り直しがまだ動いている記録 … 手動と並ぶと二重に届く(d23b R412)
 *   - 自動の送り直しですでに届いた記録 … もう一度送ると二重に届く(d23b R412)
 *
 * d23b R405: 以前は先頭から固定件数だけ読んでいたため、消えた・止まった
 * 送り先の記録が先頭に固まると、後ろの送れる記録へ何度押しても届かなかった。
 * 選ぶ段階で対象外を外し、残りを必ず処理できるようにする。
 */
export const RETRYABLE_FAILURE_CORE = `
  (l.failure_reason IS NULL OR l.failure_reason NOT IN ('unknown','secret_unavailable'))
  AND l.request_body_json IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM outgoing_webhooks ow
     WHERE ow.id = l.webhook_id AND ow.is_active = 1 AND ow.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM outgoing_webhook_deliveries d
     WHERE d.webhook_id = l.webhook_id
       AND d.idempotency_key = l.idempotency_key
       AND d.status IN ('pending','sending','retry_wait','delivered')
  )`;

export const RETRYABLE_FAILURE_FILTER =
  `l.direction='outgoing' AND l.status='failed' AND ${RETRYABLE_FAILURE_CORE}`;

export async function listFailedWebhookInteractionsForRetry(
  db: D1Database,
  lineAccountId: string,
  limit = 50,
): Promise<WebhookInteractionRow[]> {
  const result = await db.prepare(
    `SELECT l.* FROM webhook_interaction_logs l
      WHERE l.line_account_id=? AND ${RETRYABLE_FAILURE_FILTER}
      ORDER BY l.created_at ASC LIMIT ?`,
  ).bind(lineAccountId, Math.min(50, Math.max(1, limit))).all<WebhookInteractionRow>();
  return result.results ?? [];
}

/**
 * まとめて再試行の対象になる失敗記録の総数。
 * 1リクエストの外部通信上限で一部しか処理できないとき、残り件数を
 * 画面へ明示するために使う（N-387: 対象外を黙って残さない）。
 * 結果不明の記録は対象外なので、ここでも数えない(IDEA-26)。
 */
export async function countFailedWebhookInteractionsForRetry(
  db: D1Database,
  lineAccountId: string,
): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM webhook_interaction_logs l
      WHERE l.line_account_id=? AND ${RETRYABLE_FAILURE_FILTER}`,
  ).bind(lineAccountId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

/**
 * まとめて再送の対象外に残った失敗記録の総数(d23b R405/R408)。
 * 送り先が消えた・止まった・内容が残っていない・自動の送り直しが
 * 動いている・署名の合言葉が読めない、のどれかに当たる記録を数える。
 * 「届いたか分からない」記録は別口(needsReview)で数えるので含めない。
 */
export async function countExcludedFailedWebhookInteractions(
  db: D1Database,
  lineAccountId: string,
): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM webhook_interaction_logs l
      WHERE l.line_account_id=? AND l.direction='outgoing' AND l.status='failed'
        AND (l.failure_reason IS NULL OR l.failure_reason <> 'unknown')
        AND NOT (${RETRYABLE_FAILURE_CORE})`,
  ).bind(lineAccountId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

/**
 * 「届いたか分からない」失敗記録の総数(IDEA-26)。
 * まとめて再送には乗せず、画面へ「相手先で確かめる必要がある件数」として返す。
 */
export async function countUnverifiedWebhookInteractions(
  db: D1Database,
  lineAccountId: string,
): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM webhook_interaction_logs
      WHERE line_account_id=? AND direction='outgoing' AND status='failed'
        AND failure_reason='unknown'`,
  ).bind(lineAccountId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function getOutgoingWebhookDeliverySummaries(
  db: D1Database,
  lineAccountId: string,
  periodDays = 30,
): Promise<OutgoingWebhookDeliverySummaryRow[]> {
  const days = Math.min(365, Math.max(1, Math.floor(periodDays)));
  const cutoff = toJstString(new Date(Date.now() - days * 86_400_000));
  const result = await db.prepare(`
    WITH recent AS (
      SELECT *
        FROM webhook_interaction_logs
       WHERE line_account_id = ? AND direction = 'outgoing'
         AND created_at >= ? AND status != 'retried'
    ), totals AS (
      SELECT webhook_id,
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
             SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
        FROM recent
       WHERE webhook_id IS NOT NULL
       GROUP BY webhook_id
    ), latest AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY webhook_id ORDER BY created_at DESC, id DESC
      ) AS row_number
        FROM recent
       WHERE webhook_id IS NOT NULL
    )
    SELECT ow.id AS webhook_id,
           COALESCE(t.total, 0) AS total,
           COALESCE(t.succeeded, 0) AS succeeded,
           COALESCE(t.failed, 0) AS failed,
           COALESCE(t.pending, 0) AS pending,
           l.status AS last_status,
           l.response_status AS last_response_status,
           l.completed_at AS last_completed_at,
           l.failure_reason AS last_failure_reason,
           CASE WHEN ow.is_active = 1 AND l.status = 'failed'
                  AND l.request_body_json IS NOT NULL THEN 1 ELSE 0 END AS can_retry
      FROM outgoing_webhooks ow
 LEFT JOIN totals t ON t.webhook_id = ow.id
 LEFT JOIN latest l ON l.webhook_id = ow.id AND l.row_number = 1
     WHERE ow.line_account_id = ? AND ow.deleted_at IS NULL
     ORDER BY ow.created_at DESC, ow.id ASC
  `).bind(lineAccountId, cutoff, lineAccountId).all<OutgoingWebhookDeliverySummaryRow>();
  return result.results ?? [];
}
