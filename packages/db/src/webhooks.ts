import { jstNow, toJstString } from './utils.js';
// Webhook IN/OUT クエリヘルパー

export interface IncomingWebhookRow {
  id: string;
  name: string;
  source_type: string;
  secret: string | null;
  is_active: number;
  line_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutgoingWebhookRow {
  id: string;
  name: string;
  url: string;
  event_types: string; // JSON配列
  secret: string | null;
  is_active: number;
  /** 失敗したとき何回まで送り直すか。0 なら送り直さない */
  max_retries: number;
  /** 連続して失敗している回数。成功すると 0 に戻る */
  consecutive_failures: number;
  /** 最後に失敗した時刻。成功すると NULL に戻る */
  last_failed_at: string | null;
  line_account_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type WebhookInteractionDirection = 'outgoing' | 'incoming';
export type WebhookInteractionStatus = 'pending' | 'succeeded' | 'failed' | 'retried';
export type WebhookInteractionFailureReason =
  | 'connection_failed'
  | 'response_4xx'
  | 'response_429'
  | 'response_5xx'
  | 'processing_failed'
  | 'unknown';

export interface WebhookInteractionRow {
  id: string;
  line_account_id: string;
  direction: WebhookInteractionDirection;
  webhook_id: string | null;
  webhook_name: string;
  event_type: string;
  trigger_summary: string;
  status: WebhookInteractionStatus;
  request_body_json: string | null;
  response_status: number | null;
  attempt_count: number;
  duration_ms: number | null;
  failure_reason: WebhookInteractionFailureReason | null;
  idempotency_key: string;
  retry_of_id: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface WebhookInteractionSummary {
  total: number;
  outgoing: number;
  incoming: number;
  succeeded: number;
  failed: number;
  averageDurationMs: number | null;
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
  },
): Promise<{
  items: WebhookInteractionRow[];
  total: number;
  page: number;
  limit: number;
  summary: WebhookInteractionSummary;
}> {
  const integerOr = (value: number | undefined, fallback: number) =>
    Number.isFinite(value) ? Math.floor(value as number) : fallback;
  const periodDays = Math.min(365, Math.max(1, integerOr(input.periodDays, 30)));
  const cutoff = toJstString(new Date(Date.now() - periodDays * 86_400_000));
  const page = Math.max(1, integerOr(input.page, 1));
  const limit = Math.min(50, Math.max(10, integerOr(input.limit, 20)));
  const clauses = ['line_account_id=?', 'created_at>=?', "status!='retried'"];
  const binds: unknown[] = [input.lineAccountId, cutoff];
  if (input.direction) {
    clauses.push('direction=?');
    binds.push(input.direction);
  }
  if (input.status) {
    clauses.push('status=?');
    binds.push(input.status);
  }
  if (input.search?.trim()) {
    clauses.push('(webhook_name LIKE ? OR trigger_summary LIKE ? OR event_type LIKE ?)');
    const like = `%${input.search.trim().slice(0, 100)}%`;
    binds.push(like, like, like);
  }
  const where = clauses.join(' AND ');
  const [rows, totalRow, summaryRow] = await Promise.all([
    db.prepare(
      `SELECT * FROM webhook_interaction_logs WHERE ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...binds, limit, (page - 1) * limit).all<WebhookInteractionRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM webhook_interaction_logs WHERE ${where}`)
      .bind(...binds).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN direction='outgoing' THEN 1 ELSE 0 END) AS outgoing,
              SUM(CASE WHEN direction='incoming' THEN 1 ELSE 0 END) AS incoming,
              SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) AS succeeded,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
              AVG(CASE WHEN status IN ('succeeded','failed') THEN duration_ms END) AS average_duration_ms
         FROM webhook_interaction_logs
        WHERE line_account_id=? AND created_at>=? AND status!='retried'`,
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
      averageDurationMs: summaryRow?.average_duration_ms == null
        ? null
        : Math.round(summaryRow.average_duration_ms),
    },
  };
}

export async function listFailedWebhookInteractionsForRetry(
  db: D1Database,
  lineAccountId: string,
  limit = 50,
): Promise<WebhookInteractionRow[]> {
  const result = await db.prepare(
    `SELECT * FROM webhook_interaction_logs
      WHERE line_account_id=? AND direction='outgoing' AND status='failed'
      ORDER BY created_at ASC LIMIT ?`,
  ).bind(lineAccountId, Math.min(50, Math.max(1, limit))).all<WebhookInteractionRow>();
  return result.results ?? [];
}

// --- 受信Webhook ---

export async function getIncomingWebhooks(
  db: D1Database,
  lineAccountId: string,
): Promise<IncomingWebhookRow[]> {
  const result = await db
    .prepare(`SELECT * FROM incoming_webhooks WHERE line_account_id = ? ORDER BY created_at DESC`)
    .bind(lineAccountId)
    .all<IncomingWebhookRow>();
  return result.results;
}

export async function getIncomingWebhookById(
  db: D1Database,
  id: string,
  lineAccountId?: string,
): Promise<IncomingWebhookRow | null> {
  if (lineAccountId === undefined) {
    return db.prepare(`SELECT * FROM incoming_webhooks WHERE id = ?`).bind(id).first<IncomingWebhookRow>();
  }
  return db
    .prepare(`SELECT * FROM incoming_webhooks WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId)
    .first<IncomingWebhookRow>();
}

export async function createIncomingWebhook(
  db: D1Database,
  input: { name: string; sourceType?: string; secret?: string; lineAccountId: string },
): Promise<IncomingWebhookRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(`INSERT INTO incoming_webhooks (id, name, source_type, secret, line_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.name, input.sourceType ?? 'custom', input.secret ?? null, input.lineAccountId, now, now)
    .run();
  return (await getIncomingWebhookById(db, id, input.lineAccountId))!;
}

export async function updateIncomingWebhook(
  db: D1Database,
  id: string,
  lineAccountId: string,
  updates: Partial<{ name: string; sourceType: string; secret: string; isActive: boolean }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.sourceType !== undefined) { sets.push('source_type = ?'); values.push(updates.sourceType); }
  if (updates.secret !== undefined) { sets.push('secret = ?'); values.push(updates.secret); }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  values.push(lineAccountId);
  await db.prepare(`UPDATE incoming_webhooks SET ${sets.join(', ')} WHERE id = ? AND line_account_id = ?`)
    .bind(...values).run();
}

export async function deleteIncomingWebhook(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<void> {
  await db.prepare(`DELETE FROM incoming_webhooks WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId).run();
}

// --- 送信Webhook ---
export async function getOutgoingWebhooks(
  db: D1Database,
  lineAccountId: string,
): Promise<OutgoingWebhookRow[]> {
  const result = await db
    .prepare(`SELECT * FROM outgoing_webhooks WHERE line_account_id = ? ORDER BY created_at DESC`)
    .bind(lineAccountId)
    .all<OutgoingWebhookRow>();
  return result.results;
}

export async function getOutgoingWebhookById(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<OutgoingWebhookRow | null> {
  return db
    .prepare(`SELECT * FROM outgoing_webhooks WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId)
    .first<OutgoingWebhookRow>();
}

export async function createOutgoingWebhook(
  db: D1Database,
  input: { name: string; url: string; eventTypes: string[]; secret?: string; maxRetries?: number; lineAccountId: string },
): Promise<OutgoingWebhookRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(`INSERT INTO outgoing_webhooks (id, name, url, event_types, secret, max_retries, line_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.name, input.url, JSON.stringify(input.eventTypes), input.secret ?? null, input.maxRetries ?? 0, input.lineAccountId, now, now)
    .run();
  return (await getOutgoingWebhookById(db, id, input.lineAccountId))!;
}

export async function updateOutgoingWebhook(
  db: D1Database,
  id: string,
  lineAccountId: string,
  updates: Partial<{
    name: string;
    url: string;
    eventTypes: string[];
    secret: string;
    isActive: boolean;
    maxRetries: number;
  }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.url !== undefined) { sets.push('url = ?'); values.push(updates.url); }
  if (updates.eventTypes !== undefined) { sets.push('event_types = ?'); values.push(JSON.stringify(updates.eventTypes)); }
  if (updates.secret !== undefined) { sets.push('secret = ?'); values.push(updates.secret); }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (updates.maxRetries !== undefined) { sets.push('max_retries = ?'); values.push(updates.maxRetries); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  values.push(lineAccountId);
  await db.prepare(`UPDATE outgoing_webhooks SET ${sets.join(', ')} WHERE id = ? AND line_account_id = ?`)
    .bind(...values).run();
}

export async function deleteOutgoingWebhook(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<void> {
  await db.prepare(`DELETE FROM outgoing_webhooks WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId).run();
}

/** 指定イベントタイプに一致するアクティブな送信Webhookを取得 */
export async function getActiveOutgoingWebhooksByEvent(
  db: D1Database,
  eventType: string,
  lineAccountId?: string | null,
): Promise<OutgoingWebhookRow[]> {
  if (!lineAccountId) return [];
  const all = await db
    .prepare(`
      SELECT *
      FROM outgoing_webhooks
      WHERE is_active = 1 AND line_account_id = ?
    `)
    .bind(lineAccountId)
    .all<OutgoingWebhookRow>();
  return all.results.filter((w) => {
    const types: string[] = JSON.parse(w.event_types);
    return types.includes(eventType) || types.includes('*');
  });
}
