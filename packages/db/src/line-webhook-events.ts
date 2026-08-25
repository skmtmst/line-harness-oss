export type LineWebhookEventStatus = 'received' | 'processing' | 'succeeded' | 'failed';

export type LineWebhookErrorClassification = 'line_api_error' | 'db_error' | 'unknown';

export interface LineWebhookEventRow {
  webhook_event_id: string;
  line_account_id: string | null;
  event_type: string;
  status: LineWebhookEventStatus;
  attempts: number;
  last_error: LineWebhookErrorClassification | null;
  received_at: string;
  updated_at: string;
}

export interface LineWebhookEventSafeView {
  webhookEventId: string;
  lineAccountId: string | null;
  eventType: string;
  status: LineWebhookEventStatus;
  attempts: number;
  lastError: LineWebhookErrorClassification | null;
  receivedAt: string;
  updatedAt: string;
}

/**
 * LINEから届いたイベントIDを先に予約する。
 * INSERT OR IGNORE の changes=1 を得た呼び出しだけが後続処理へ進める。
 */
export async function reserveLineWebhookEvent(
  db: D1Database,
  input: { webhookEventId: string; lineAccountId: string | null; eventType: string },
): Promise<boolean> {
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO line_webhook_events
         (webhook_event_id, line_account_id, event_type, status)
       VALUES (?, ?, ?, 'processing')`,
    )
    .bind(input.webhookEventId, input.lineAccountId, input.eventType)
    .run();
  return (inserted.meta?.changes ?? 0) === 1;
}

export async function markLineWebhookEventSucceeded(
  db: D1Database,
  webhookEventId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE line_webhook_events
          SET status = 'succeeded', last_error = NULL,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE webhook_event_id = ?`,
    )
    .bind(webhookEventId)
    .run();
}

export async function markLineWebhookEventFailed(
  db: D1Database,
  webhookEventId: string,
  classification: LineWebhookErrorClassification,
): Promise<void> {
  await db
    .prepare(
      `UPDATE line_webhook_events
          SET status = 'failed', attempts = attempts + 1, last_error = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE webhook_event_id = ?`,
    )
    .bind(classification, webhookEventId)
    .run();
}

export async function getLineWebhookEvent(
  db: D1Database,
  webhookEventId: string,
): Promise<LineWebhookEventRow | null> {
  return db
    .prepare(
      `SELECT webhook_event_id, line_account_id, event_type, status, attempts,
              last_error, received_at, updated_at
         FROM line_webhook_events
        WHERE webhook_event_id = ?`,
    )
    .bind(webhookEventId)
    .first<LineWebhookEventRow>();
}

export async function listLineWebhookEvents(
  db: D1Database,
  input: {
    status?: LineWebhookEventStatus;
    lineAccountIds: string[];
    includeUnassigned: boolean;
    limit?: number;
  },
): Promise<LineWebhookEventSafeView[]> {
  if (input.lineAccountIds.length === 0 && !input.includeUnassigned) return [];

  const limit = Math.max(1, Math.min(input.limit ?? 100, 200));
  // D1のバインド変数上限に余裕を持たせる。多数店舗の統括でも一覧を壊さない。
  const accountChunks: string[][] = [];
  for (let offset = 0; offset < input.lineAccountIds.length; offset += 80) {
    accountChunks.push(input.lineAccountIds.slice(offset, offset + 80));
  }

  const rows: LineWebhookEventRow[] = [];
  if (input.includeUnassigned) {
    const statusClause = input.status ? 'AND status = ?' : '';
    const bindings: Array<string | number> = [];
    if (input.status) bindings.push(input.status);
    bindings.push(limit);
    const result = await db
      .prepare(
        `SELECT webhook_event_id, line_account_id, event_type, status, attempts,
                last_error, received_at, updated_at
           FROM line_webhook_events
          WHERE line_account_id IS NULL
            ${statusClause}
          ORDER BY received_at DESC
          LIMIT ?`,
      )
      .bind(...bindings)
      .all<LineWebhookEventRow>();
    rows.push(...result.results);
  }
  for (const accountIds of accountChunks) {
    const placeholders = accountIds.map(() => '?').join(', ');
    const statusClause = input.status ? 'AND status = ?' : '';
    const bindings: Array<string | number> = [...accountIds];
    if (input.status) bindings.push(input.status);
    bindings.push(limit);

    const result = await db
      .prepare(
        `SELECT webhook_event_id, line_account_id, event_type, status, attempts,
                last_error, received_at, updated_at
           FROM line_webhook_events
          WHERE line_account_id IN (${placeholders})
            ${statusClause}
          ORDER BY received_at DESC
          LIMIT ?`,
      )
      .bind(...bindings)
      .all<LineWebhookEventRow>();
    rows.push(...result.results);
  }

  return rows
    .sort((left, right) => right.received_at.localeCompare(left.received_at))
    .slice(0, limit)
    .map((row) => ({
      webhookEventId: row.webhook_event_id,
      lineAccountId: row.line_account_id,
      eventType: row.event_type,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      receivedAt: row.received_at,
      updatedAt: row.updated_at,
    }));
}
