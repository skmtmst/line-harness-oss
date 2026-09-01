import { jstNow } from './utils.js';
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
