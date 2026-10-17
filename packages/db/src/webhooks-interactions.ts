import type { WebhookInteractionFailureReason } from './webhook-failure-types.js';
import { EC_EVENT_TYPES } from '@line-crm/shared';
import { jstNow, toJstString } from './utils.js';
import { type WebhookInteractionDirection, type WebhookInteractionRow, type WebhookInteractionListRow, type WebhookInteractionSummary, type OutgoingWebhookDeliverySummaryRow } from './webhooks-types.js';

// Webhook IN/OUT クエリヘルパー

/**
 * 受信・送信Webhookの secret の最低文字数。API の入力検査と旧平文の表示判定は
 * この値だけを見る。apps/worker/src/routes/webhooks.ts はこれを読み替えて使う。
 */
export const WEBHOOK_SECRET_MIN_LENGTH = 32;

/**
 * 送信WebhookのeventTypesに指定できる種別の正本(#829 N-383)。
 * 実際にイベントバスへ発火され送信Webhookへ届く種別だけを載せる。
 * `*` は全種別を受け取る明示規約。受信口の発火は `incoming_webhook.<source_type>` で届く。
 */
export const KNOWN_OUTGOING_EVENT_TYPES: readonly string[] = [
  'friend_add',
  'friend_unfollow',
  'message_received',
  'postback_received',
  'tag_change',
  'cv_fire',
  'staff_assigned',
  'manual_reply_sent',
  // R150: 見本にある出来事は実際に購読できるようにする。
  // 送信側は forms.ts / booking.ts の発火点。
  'form_submitted',
  'booking_created',
  ...EC_EVENT_TYPES,
];

export const INCOMING_WEBHOOK_EVENT_PREFIX = 'incoming_webhook.';

/**
 * 送信Webhookの購読種別として有効か。
 * `*` は全件、`incoming_webhook.<source>` は受信口ごとの発火に一致する。
 * `incoming_webhook.*` は照合規約上どの発火にも一致しないので通さない。
 */
export function isKnownOutgoingEventType(eventType: string): boolean {
  if (eventType === '*') return true;
  if (KNOWN_OUTGOING_EVENT_TYPES.includes(eventType)) return true;
  if (!eventType.startsWith(INCOMING_WEBHOOK_EVENT_PREFIX)) return false;
  const sourceType = eventType.slice(INCOMING_WEBHOOK_EVENT_PREFIX.length);
  return sourceType.length > 0 && !sourceType.includes('*');
}

export async function createWebhookInteraction(
  db: D1Database,
  input: {
    id?: string;
    lineAccountId: string;
    direction: WebhookInteractionDirection;
    webhookId?: string | null;
    webhookName: string;
    eventType: string;
    triggerSummary: string;
    requestBodyJson?: string | null;
    idempotencyKey?: string;
    retryOfId?: string | null;
    startedAt?: string;
  },
): Promise<WebhookInteractionRow> {
  const id = input.id ?? crypto.randomUUID();
  const now = input.startedAt ?? jstNow();
  await db.prepare(
    `INSERT INTO webhook_interaction_logs
       (id, line_account_id, direction, webhook_id, webhook_name, event_type,
        trigger_summary, status, request_body_json, response_status,
        attempt_count, duration_ms, failure_reason, idempotency_key,
        retry_of_id, started_at, completed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, 0, NULL, NULL, ?, ?, ?, NULL, ?)`,
  ).bind(
    id,
    input.lineAccountId,
    input.direction,
    input.webhookId ?? null,
    input.webhookName,
    input.eventType,
    input.triggerSummary,
    input.requestBodyJson ?? null,
    input.idempotencyKey ?? crypto.randomUUID(),
    input.retryOfId ?? null,
    now,
    now,
  ).run();
  return (await getWebhookInteractionById(db, id, input.lineAccountId))!;
}

export async function finishWebhookInteraction(
  db: D1Database,
  id: string,
  lineAccountId: string,
  input: {
    status: 'succeeded' | 'failed';
    responseStatus?: number | null;
    attemptCount: number;
    durationMs: number;
    failureReason?: WebhookInteractionFailureReason | null;
    completedAt?: string;
  },
): Promise<void> {
  await db.prepare(
    `UPDATE webhook_interaction_logs
        SET status=?, response_status=?, attempt_count=?, duration_ms=?,
            failure_reason=?, completed_at=?
      WHERE id=? AND line_account_id=? AND status='pending'`,
  ).bind(
    input.status,
    input.responseStatus ?? null,
    input.attemptCount,
    Math.max(0, Math.round(input.durationMs)),
    input.failureReason ?? null,
    input.completedAt ?? jstNow(),
    id,
    lineAccountId,
  ).run();
}

export async function getWebhookInteractionById(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<WebhookInteractionRow | null> {
  return db.prepare(
    'SELECT * FROM webhook_interaction_logs WHERE id=? AND line_account_id=?',
  ).bind(id, lineAccountId).first<WebhookInteractionRow>();
}

export async function claimWebhookInteractionRetry(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE webhook_interaction_logs SET status='retried'
      WHERE id=? AND line_account_id=? AND direction='outgoing' AND status='failed'`,
  ).bind(id, lineAccountId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function restoreWebhookInteractionFailure(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<void> {
  await db.prepare(
    `UPDATE webhook_interaction_logs SET status='failed'
      WHERE id=? AND line_account_id=? AND status='retried'`,
  ).bind(id, lineAccountId).run();
}

/**
 * d23b R409: 元の失敗記録を「やり直し済み」に畳むのと、やり直し用の記録を
 * 作るのを1つのDBバッチで行う。どちらかだけ残る中途半端な形（元は
 * retried なのにやり直し行が無い等）を作らない。
 *
 * 元の行がすでに畳まれている(別のやり直しが先に動いた)ときは、INSERT 側の
 * NOT EXISTS(retry_of_id) が通らず、UPDATE 側も status='failed' でないので
 * 0件になる。やり直し行が一度作られていれば、その後の重複した申込は
 * どちらも何もしない。片方だけ失敗したときはバッチごと巻き戻される。
 */
export async function claimWebhookInteractionRetryAndInsert(
  db: D1Database,
  original: Pick<WebhookInteractionRow, 'id' | 'line_account_id'>,
  input: {
    id?: string;
    webhookId: string;
    webhookName: string;
    eventType: string;
    triggerSummary: string;
    requestBodyJson: string;
    idempotencyKey: string;
  },
): Promise<{ claimed: boolean; retryId: string }> {
  const retryId = input.id ?? crypto.randomUUID();
  const now = jstNow();
  const [claim, insert] = await db.batch([
    db.prepare(
      `UPDATE webhook_interaction_logs SET status='retried'
        WHERE id=? AND line_account_id=? AND direction='outgoing' AND status='failed'`,
    ).bind(original.id, original.line_account_id),
    db.prepare(
      `INSERT INTO webhook_interaction_logs
         (id, line_account_id, direction, webhook_id, webhook_name, event_type,
          trigger_summary, status, request_body_json, response_status,
          attempt_count, duration_ms, failure_reason, idempotency_key,
          retry_of_id, started_at, completed_at, created_at)
       SELECT ?, ?, 'outgoing', ?, ?, ?, ?, 'pending', ?, NULL, 0, NULL, NULL, ?, ?, ?, NULL, ?
        WHERE EXISTS (
          SELECT 1 FROM webhook_interaction_logs WHERE id = ? AND status = 'retried'
        )
        AND NOT EXISTS (
          SELECT 1 FROM webhook_interaction_logs WHERE retry_of_id = ?
        )`,
    ).bind(
      retryId, original.line_account_id, input.webhookId, input.webhookName,
      input.eventType, input.triggerSummary, input.requestBodyJson,
      input.idempotencyKey, original.id, now, now, original.id, original.id,
    ),
  ]);
  const claimChanged = Number(claim.meta?.changes ?? 0) > 0;
  const insertChanged = Number(insert.meta?.changes ?? 0) > 0;
  if (!claimChanged && insertChanged) {
    // まれな割り込み(先のやり直しが claim 済みだが行がまだ無い瞬間)で
    // 孤児の pending 行が残らないよう、自分が作った分だけ消す。
    try {
      await deletePendingWebhookInteraction(db, retryId, original.line_account_id);
    } catch (error) {
      console.error(JSON.stringify({"code":"src_webhooks_failed"}));
    }
  }
  return { claimed: claimChanged && insertChanged, retryId };
}

/**
 * 送る前に止まったやり直しの記録を消す（d23b R413）。
 * まだ外部へ一度も出ていない pending の行だけを消す。確定済みの行は
 * 履歴なので消さない。
 */
export async function deletePendingWebhookInteraction(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<void> {
  await db.prepare(
    `DELETE FROM webhook_interaction_logs
      WHERE id=? AND line_account_id=? AND status='pending'`,
  ).bind(id, lineAccountId).run();
}

/**
 * d23b R409: 「処理中」のまま放置された記録を「届いたか分からない失敗」へ
 * 直す。始まった時刻から一定時間(既定15分)が過ぎた pending は、結果を書く
 * 途中で止まったものとみなす。一覧から永久に消えない・処理中のままに
 * しないための回収。
 */
export async function markStalePendingWebhookInteractions(
  db: D1Database,
  lineAccountId: string,
  staleBeforeMs = 15 * 60 * 1000,
): Promise<number> {
  const cutoff = toJstString(new Date(Date.now() - staleBeforeMs));
  const result = await db.prepare(
    `UPDATE webhook_interaction_logs
        SET status='failed', failure_reason='unknown', completed_at=?
      WHERE line_account_id=? AND status='pending' AND started_at < ?`,
  ).bind(jstNow(), lineAccountId, cutoff).run();
  return Number(result.meta?.changes ?? 0);
}

/**
 * d23b R412: 同じ通知（同じ送り先＋同じ冪等キー）の失敗記録をまとめて
 * 「やり直し済み」へ畳む。手動・自動のどちらかで届いたとき、残っている
 * 失敗記録をそのまま「やり直せる」状態で残さない。
 */
export async function markFailedInteractionsRetried(
  db: D1Database,
  lineAccountId: string,
  webhookId: string,
  idempotencyKey: string,
): Promise<void> {
  await db.prepare(
    `UPDATE webhook_interaction_logs SET status='retried'
      WHERE line_account_id=? AND webhook_id=? AND idempotency_key=?
        AND direction='outgoing' AND status='failed'`,
  ).bind(lineAccountId, webhookId, idempotencyKey).run();
}

/**
 * 同じ通知がすでに届いた記録があるか(d23b R412)。
 * 自動配送の回収が送る前に確かめ、手動のやり直しで届いた分を
 * 二重に送らない。
 */
export async function hasSucceededInteractionForKey(
  db: D1Database,
  lineAccountId: string,
  webhookId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS yes FROM webhook_interaction_logs
      WHERE line_account_id=? AND webhook_id=? AND idempotency_key=?
        AND direction='outgoing' AND status='succeeded'
      LIMIT 1`,
  ).bind(lineAccountId, webhookId, idempotencyKey).first<{ yes: number }>();
  return Boolean(row?.yes);
}

export async function listWebhookInteractions(
  db: D1Database,
  input: {
    lineAccountId: string;
    periodDays?: number;
    direction?: WebhookInteractionDirection;
    status?: 'succeeded' | 'failed';
    search?: string;
    page?: number;
    limit?: number;
    /** Internal export only. The HTTP list route never passes this option. */
    exportAll?: boolean;
  },
): Promise<{
  items: WebhookInteractionListRow[];
  total: number;
  page: number;
  limit: number;
  summary: WebhookInteractionSummary;
}> {
  const integerOr = (value: number | undefined, fallback: number) =>
    Number.isFinite(value) ? Math.floor(value as number) : fallback;
  const periodDays = Math.min(365, Math.max(1, integerOr(input.periodDays, 30)));
  const cutoff = toJstString(new Date(Date.now() - periodDays * 86_400_000));
  const page = input.exportAll ? 1 : Math.max(1, integerOr(input.page, 1));
  const limit = input.exportAll ? 5001 : Math.min(50, Math.max(10, integerOr(input.limit, 20)));
  // d23b R409: 結果を書く途中で止まった「処理中」を先に回収する。
  // 一覧を開いた時点で回収すれば、滞留分はここで失敗として見える。
  try {
    await markStalePendingWebhookInteractions(db, input.lineAccountId);
  } catch (error) {
    // 回収だけの失敗で一覧そのものを止めない。
    console.error(JSON.stringify({"code":"src_webhooks_failed"}));
  }
  const clauses = ['l.line_account_id=?', 'l.created_at>=?', "l.status!='retried'"];
  const binds: unknown[] = [input.lineAccountId, cutoff];
  if (input.direction) {
    clauses.push('l.direction=?');
    binds.push(input.direction);
  }
  if (input.status) {
    clauses.push('l.status=?');
    binds.push(input.status);
  }
  if (input.search?.trim()) {
    clauses.push('(l.webhook_name LIKE ? OR l.trigger_summary LIKE ? OR l.event_type LIKE ?)');
    const like = `%${input.search.trim().slice(0, 100)}%`;
    binds.push(like, like, like);
  }
  const where = clauses.join(' AND ');
  // d23b R414: 送り先の現状と、同じ通知の自動配送の現状を添える。
  // 画面は「消えた・止まった・自動で動いている」理由を行ごとに出せる。
  // 削除印のある送り先は「無い」として扱う（N-368）。
  const joinedTables = `webhook_interaction_logs l
    LEFT JOIN outgoing_webhooks ow
           ON ow.id = l.webhook_id AND ow.deleted_at IS NULL
    LEFT JOIN outgoing_webhook_deliveries d
           ON d.webhook_id = l.webhook_id AND d.idempotency_key = l.idempotency_key`;
  const [rows, totalRow, summaryRow] = await Promise.all([
    db.prepare(
      `SELECT l.*,
              ow.is_active AS linked_webhook_active,
              d.status AS delivery_status,
              d.next_retry_at AS delivery_next_retry_at
         FROM ${joinedTables}
        WHERE ${where}
        ORDER BY l.created_at DESC,l.id DESC LIMIT ? OFFSET ?`,
    ).bind(...binds, limit, (page - 1) * limit).all<WebhookInteractionListRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM webhook_interaction_logs l WHERE ${where}`)
      .bind(...binds).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN l.direction='outgoing' THEN 1 ELSE 0 END) AS outgoing,
              SUM(CASE WHEN l.direction='incoming' THEN 1 ELSE 0 END) AS incoming,
              SUM(CASE WHEN l.status='succeeded' THEN 1 ELSE 0 END) AS succeeded,
              SUM(CASE WHEN l.status='failed' THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN l.direction='outgoing' AND l.status='failed' THEN 1 ELSE 0 END) AS outgoing_failed,
              SUM(CASE WHEN ${RETRYABLE_FAILURE_CORE} THEN 1 ELSE 0 END) AS retryable,
              SUM(CASE WHEN l.status='failed' AND l.failure_reason='unknown' THEN 1 ELSE 0 END) AS result_unknown,
              AVG(CASE WHEN l.status IN ('succeeded','failed') THEN l.duration_ms END) AS average_duration_ms
         FROM ${joinedTables}
        WHERE l.line_account_id=? AND l.created_at>=? AND l.status!='retried'`,
    ).bind(input.lineAccountId, cutoff).first<Record<string, number | null>>(),
  ]);
  return {
    items: rows.results ?? [],
    total: totalRow?.count ?? 0,
    page,
    limit,
    summary: {
      total: summaryRow?.total ?? 0,
      outgoing: summaryRow?.outgoing ?? 0,
      incoming: summaryRow?.incoming ?? 0,
      succeeded: summaryRow?.succeeded ?? 0,
      failed: summaryRow?.failed ?? 0,
      outgoingFailed: summaryRow?.outgoing_failed ?? 0,
      retryable: summaryRow?.retryable ?? 0,
      resultUnknown: summaryRow?.result_unknown ?? 0,
      averageDurationMs: summaryRow?.average_duration_ms == null
        ? null
        : Math.round(summaryRow.average_duration_ms),
    },
  };
}

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
