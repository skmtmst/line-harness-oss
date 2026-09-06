import { jstNow } from './utils.js';

export type CustomerNotificationStatus = 'draft' | 'published' | 'stopped';
export type NotificationDeliveryStatus =
  | 'pending'
  | 'provider_accepted'
  | 'excluded'
  | 'retry_wait'
  | 'failed';

export class LineNotificationError extends Error {
  constructor(
    readonly code: 'not_found' | 'version_conflict' | 'duplicate_key',
    message: string,
  ) {
    super(message);
  }
}

export interface CustomerNotificationDefinitionRow {
  id: string;
  line_account_id: string;
  key: string;
  name: string;
  category: string;
  source_event_type: string;
  status: CustomerNotificationStatus;
  current_version_id: string | null;
  draft_config_json: string;
  transactional_only: number;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  current_version_number?: number | null;
}

export interface CustomerNotificationVersionRow {
  id: string;
  definition_id: string;
  version_number: number;
  config_json: string;
  line_template_json: string;
  aggregation_rule: string;
  email_fallback_policy: string;
  published_by: string;
  published_at: string;
}

export async function listCustomerNotificationDefinitions(
  db: D1Database,
  lineAccountId: string,
): Promise<CustomerNotificationDefinitionRow[]> {
  const result = await db.prepare(`
    SELECT d.*, v.version_number AS current_version_number
      FROM customer_notification_definitions d
      LEFT JOIN customer_notification_versions v ON v.id = d.current_version_id
     WHERE d.line_account_id = ?
     ORDER BY d.category, d.name, d.id
  `).bind(lineAccountId).all<CustomerNotificationDefinitionRow>();
  return result.results;
}

export async function getCustomerNotificationDefinition(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<{ definition: CustomerNotificationDefinitionRow; versions: CustomerNotificationVersionRow[] } | null> {
  const definition = await db.prepare(`
    SELECT d.*, v.version_number AS current_version_number
      FROM customer_notification_definitions d
      LEFT JOIN customer_notification_versions v ON v.id = d.current_version_id
     WHERE d.id = ? AND d.line_account_id = ?
  `).bind(id, lineAccountId).first<CustomerNotificationDefinitionRow>();
  if (!definition) return null;
  const versions = await db.prepare(`
    SELECT * FROM customer_notification_versions
     WHERE definition_id = ? ORDER BY version_number DESC
  `).bind(id).all<CustomerNotificationVersionRow>();
  return { definition, versions: versions.results };
}

export async function createCustomerNotificationDefinition(
  db: D1Database,
  input: {
    lineAccountId: string;
    key: string;
    name: string;
    category: string;
    sourceEventType: string;
    draftConfig: Record<string, unknown>;
    staffId: string;
  },
): Promise<{ definition: CustomerNotificationDefinitionRow; versions: CustomerNotificationVersionRow[] }> {
  const id = crypto.randomUUID();
  const now = jstNow();
  try {
    await db.prepare(`
      INSERT INTO customer_notification_definitions
        (id, line_account_id, key, name, category, source_event_type, status,
         draft_config_json, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
    `).bind(
      id,
      input.lineAccountId,
      input.key,
      input.name,
      input.category,
      input.sourceEventType,
      JSON.stringify(input.draftConfig),
      input.staffId,
      input.staffId,
      now,
      now,
    ).run();
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      throw new LineNotificationError('duplicate_key', '同じキーのお知らせが既にあります');
    }
    throw error;
  }
  return (await getCustomerNotificationDefinition(db, id, input.lineAccountId))!;
}

export async function updateCustomerNotificationDraft(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    expectedVersion: number;
    name: string;
    category: string;
    sourceEventType: string;
    draftConfig: Record<string, unknown>;
    staffId: string;
  },
): Promise<{ definition: CustomerNotificationDefinitionRow; versions: CustomerNotificationVersionRow[] }> {
  const current = await getCustomerNotificationDefinition(db, input.id, input.lineAccountId);
  if (!current) throw new LineNotificationError('not_found', 'お知らせが見つかりません');
  const result = await db.prepare(`
    UPDATE customer_notification_definitions
       SET name = ?, category = ?, source_event_type = ?, draft_config_json = ?,
           updated_by = ?, updated_at = ?, version = version + 1
     WHERE id = ? AND line_account_id = ? AND version = ?
  `).bind(
    input.name,
    input.category,
    input.sourceEventType,
    JSON.stringify(input.draftConfig),
    input.staffId,
    jstNow(),
    input.id,
    input.lineAccountId,
    input.expectedVersion,
  ).run();
  if (!Number(result.meta.changes ?? 0)) {
    throw new LineNotificationError('version_conflict', 'ほかの担当者が先に変更しました');
  }
  return (await getCustomerNotificationDefinition(db, input.id, input.lineAccountId))!;
}

export async function publishCustomerNotificationDefinition(
  db: D1Database,
  input: { id: string; lineAccountId: string; expectedVersion: number; staffId: string },
): Promise<{ definition: CustomerNotificationDefinitionRow; versions: CustomerNotificationVersionRow[] }> {
  const current = await getCustomerNotificationDefinition(db, input.id, input.lineAccountId);
  if (!current) throw new LineNotificationError('not_found', 'お知らせが見つかりません');
  if (Number(current.definition.version) !== input.expectedVersion) {
    throw new LineNotificationError('version_conflict', 'ほかの担当者が先に変更しました');
  }

  const versionId = crypto.randomUUID();
  const now = jstNow();
  let results: D1Result[];
  try {
    results = await db.batch([
      db.prepare(`
      INSERT INTO customer_notification_versions
        (id, definition_id, version_number, config_json, line_template_json,
         aggregation_rule, email_fallback_policy, published_by, published_at)
      SELECT ?, d.id,
             COALESCE((SELECT MAX(v.version_number) + 1
                         FROM customer_notification_versions v
                        WHERE v.definition_id = d.id), 1),
             d.draft_config_json,
             COALESCE(json_extract(d.draft_config_json, '$.lineTemplate'), '[]'),
             COALESCE(json_extract(d.draft_config_json, '$.aggregationRule'), 'definition_day'),
             COALESCE(json_extract(d.draft_config_json, '$.emailFallbackPolicy'), 'disabled'),
             ?, ?
        FROM customer_notification_definitions d
       WHERE d.id = ? AND d.line_account_id = ? AND d.version = ?
      `).bind(versionId, input.staffId, now, input.id, input.lineAccountId, input.expectedVersion),
      db.prepare(`
      UPDATE customer_notification_definitions
         SET current_version_id = ?, status = 'published', updated_by = ?,
             updated_at = ?, version = version + 1
       WHERE id = ? AND line_account_id = ? AND version = ?
      `).bind(
        versionId,
        input.staffId,
        now,
        input.id,
        input.lineAccountId,
        input.expectedVersion,
      ),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      throw new LineNotificationError('version_conflict', 'ほかの担当者が先に変更しました');
    }
    throw error;
  }
  if (!Number(results[1]?.meta.changes ?? 0)) {
    throw new LineNotificationError('version_conflict', 'ほかの担当者が先に変更しました');
  }
  return (await getCustomerNotificationDefinition(db, input.id, input.lineAccountId))!;
}

export async function stopCustomerNotificationDefinition(
  db: D1Database,
  input: { id: string; lineAccountId: string; expectedVersion: number; staffId: string },
): Promise<{ definition: CustomerNotificationDefinitionRow; versions: CustomerNotificationVersionRow[] }> {
  const current = await getCustomerNotificationDefinition(db, input.id, input.lineAccountId);
  if (!current) throw new LineNotificationError('not_found', 'お知らせが見つかりません');
  const result = await db.prepare(`
    UPDATE customer_notification_definitions
       SET status = 'stopped', updated_by = ?, updated_at = ?, version = version + 1
     WHERE id = ? AND line_account_id = ? AND version = ?
  `).bind(
    input.staffId,
    jstNow(),
    input.id,
    input.lineAccountId,
    input.expectedVersion,
  ).run();
  if (!Number(result.meta.changes ?? 0)) {
    throw new LineNotificationError('version_conflict', 'ほかの担当者が先に変更しました');
  }
  return (await getCustomerNotificationDefinition(db, input.id, input.lineAccountId))!;
}

export interface NotificationDeliveryListRow {
  id: string;
  audience_type: 'customer' | 'operator';
  recipient_type: string;
  recipient_id: string;
  channel: 'line' | 'email' | 'in_app';
  status: NotificationDeliveryStatus;
  retryable: number;
  attempts: number;
  next_retry_at: string | null;
  provider_status: string | null;
  error_code: string | null;
  error_message_safe: string | null;
  queued_at: string;
  accepted_at: string | null;
  execution_mode: 'automatic' | 'retry' | 'resend' | 'test';
  version: number;
  source_event_type: string;
  source_event_id: string;
  source_metadata_json: string | null;
  definition_name: string | null;
  definition_version: number | null;
  friend_name: string | null;
  clicked_at: string | null;
}

export async function listNotificationDeliveries(
  db: D1Database,
  input: { lineAccountId: string; view: 'all' | 'failures'; limit: number; offset: number },
): Promise<{
  items: NotificationDeliveryListRow[];
  total: number;
  summary: { accepted: number; failed: number; excluded: number; pending: number };
}> {
  const filter = input.view === 'failures'
    ? "AND d.status IN ('excluded', 'retry_wait', 'failed')"
    : '';
  const [items, count, summary] = await Promise.all([
    db.prepare(`
      SELECT d.id, d.audience_type, d.recipient_type, d.recipient_id, d.channel,
             d.status, d.retryable, d.attempts, d.next_retry_at, d.provider_status,
             d.error_code, d.error_message_safe, d.queued_at, d.accepted_at,
             d.execution_mode, d.version,
             i.source_event_type, i.source_event_id, i.source_metadata_json,
             def.name AS definition_name, ver.version_number AS definition_version,
             CASE WHEN d.recipient_type = 'friend' THEN f.display_name ELSE NULL END AS friend_name,
             (SELECT MAX(x.clicked_at) FROM notification_interactions x
               WHERE x.delivery_id = d.id) AS clicked_at
        FROM notification_deliveries d
        JOIN notification_instances i ON i.id = d.instance_id AND i.line_account_id = d.line_account_id
        LEFT JOIN customer_notification_definitions def
          ON def.id = i.definition_id AND def.line_account_id = d.line_account_id
        LEFT JOIN customer_notification_versions ver ON ver.id = i.definition_version_id
        LEFT JOIN friends f
          ON f.id = d.recipient_id AND f.line_account_id = d.line_account_id
       WHERE d.line_account_id = ? ${filter}
       ORDER BY d.queued_at DESC, d.id DESC LIMIT ? OFFSET ?
    `).bind(input.lineAccountId, input.limit, input.offset).all<NotificationDeliveryListRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM notification_deliveries d
                 WHERE d.line_account_id = ? ${filter}`)
      .bind(input.lineAccountId).first<{ count: number }>(),
    db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'provider_accepted' THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE WHEN status IN ('retry_wait', 'failed') THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'excluded' THEN 1 ELSE 0 END) AS excluded,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
      FROM notification_deliveries WHERE line_account_id = ?
    `).bind(input.lineAccountId).first<{
      accepted: number | null; failed: number | null; excluded: number | null; pending: number | null;
    }>(),
  ]);
  return {
    items: items.results,
    total: Number(count?.count ?? 0),
    summary: {
      accepted: Number(summary?.accepted ?? 0),
      failed: Number(summary?.failed ?? 0),
      excluded: Number(summary?.excluded ?? 0),
      pending: Number(summary?.pending ?? 0),
    },
  };
}

export interface NotificationRetryRow {
  id: string;
  line_account_id: string;
  status: NotificationDeliveryStatus;
  retryable: number;
  attempts: number;
  idempotency_key: string;
  version: number;
  channel: string;
  recipient_type: string;
  recipient_id: string;
  line_user_id: string | null;
  channel_access_token: string | null;
  line_template_json: string | null;
}

export async function getNotificationDeliveryForRetry(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<NotificationRetryRow | null> {
  return db.prepare(`
    SELECT d.id, d.line_account_id, d.status, d.retryable, d.attempts,
           d.idempotency_key, d.version, d.channel, d.recipient_type, d.recipient_id,
           f.line_user_id, a.channel_access_token, v.line_template_json
      FROM notification_deliveries d
      JOIN notification_instances i ON i.id = d.instance_id AND i.line_account_id = d.line_account_id
      JOIN line_accounts a ON a.id = d.line_account_id
      LEFT JOIN friends f ON f.id = d.recipient_id AND f.line_account_id = d.line_account_id
      LEFT JOIN customer_notification_versions v ON v.id = i.definition_version_id
     WHERE d.id = ? AND d.line_account_id = ?
  `).bind(id, lineAccountId).first<NotificationRetryRow>();
}

export async function claimNotificationDeliveryRetry(
  db: D1Database,
  input: { id: string; lineAccountId: string; expectedVersion: number },
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE notification_deliveries
       SET status = 'pending', execution_mode = 'retry', next_retry_at = NULL,
           version = version + 1, updated_at = ?
     WHERE id = ? AND line_account_id = ? AND version = ?
       AND retryable = 1 AND status IN ('retry_wait', 'failed')
  `).bind(jstNow(), input.id, input.lineAccountId, input.expectedVersion).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function finishNotificationDeliveryRetry(
  db: D1Database,
  input: {
    delivery: NotificationRetryRow;
    outcome: 'provider_accepted' | 'retry_wait' | 'failed';
    providerRequestId?: string | null;
    errorCode?: string | null;
    errorMessageSafe?: string | null;
    nextRetryAt?: string | null;
  },
): Promise<void> {
  const attemptedAt = jstNow();
  const nextAttempt = Number(input.delivery.attempts) + 1;
  await db.batch([
    db.prepare(`
      INSERT INTO notification_delivery_attempts
        (id, delivery_id, attempt_number, retry_key, outcome, provider_request_id,
         error_code, error_message_safe, attempted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      input.delivery.id,
      nextAttempt,
      input.delivery.idempotency_key,
      input.outcome,
      input.providerRequestId ?? null,
      input.errorCode ?? null,
      input.errorMessageSafe ?? null,
      attemptedAt,
    ),
    db.prepare(`
      UPDATE notification_deliveries
         SET status = ?, attempts = ?, provider_request_id = ?, provider_status = ?,
             error_code = ?, error_message_safe = ?, next_retry_at = ?,
             accepted_at = CASE WHEN ? = 'provider_accepted' THEN ? ELSE accepted_at END,
             failed_at = CASE WHEN ? IN ('retry_wait', 'failed') THEN ? ELSE NULL END,
             retryable = CASE WHEN ? = 'retry_wait' THEN 1 ELSE 0 END,
             updated_at = ?
       WHERE id = ? AND line_account_id = ?
    `).bind(
      input.outcome,
      nextAttempt,
      input.providerRequestId ?? null,
      input.outcome,
      input.errorCode ?? null,
      input.errorMessageSafe ?? null,
      input.nextRetryAt ?? null,
      input.outcome,
      attemptedAt,
      input.outcome,
      attemptedAt,
      input.outcome,
      attemptedAt,
      input.delivery.id,
      input.delivery.line_account_id,
    ),
  ]);
}

export interface NotificationMetricRow {
  definition_id: string;
  definition_name: string;
  accepted_count: number;
  display_count: number | null;
  click_count: number;
  state: 'waiting' | 'ready' | 'unavailable_privacy' | 'failed';
  reason: string | null;
}

export async function listNotificationMetrics(
  db: D1Database,
  input: { lineAccountId: string; from?: string; to?: string },
): Promise<NotificationMetricRow[]> {
  const conditions = ['m.line_account_id = ?'];
  const values: unknown[] = [input.lineAccountId];
  if (input.from) { conditions.push('m.metric_date >= ?'); values.push(input.from); }
  if (input.to) { conditions.push('m.metric_date <= ?'); values.push(input.to); }
  const result = await db.prepare(`
    SELECT m.definition_id, d.name AS definition_name,
           SUM(m.accepted_count) AS accepted_count,
           CASE WHEN SUM(CASE WHEN m.state != 'ready' THEN 1 ELSE 0 END) > 0
                THEN NULL ELSE SUM(m.display_count) END AS display_count,
           SUM(m.click_count) AS click_count,
           CASE
             WHEN SUM(CASE WHEN m.state = 'failed' THEN 1 ELSE 0 END) > 0 THEN 'failed'
             WHEN SUM(CASE WHEN m.state = 'unavailable_privacy' THEN 1 ELSE 0 END) > 0 THEN 'unavailable_privacy'
             WHEN SUM(CASE WHEN m.state = 'waiting' THEN 1 ELSE 0 END) > 0 THEN 'waiting'
             ELSE 'ready'
           END AS state,
           CASE
             WHEN SUM(CASE WHEN m.state = 'unavailable_privacy' THEN 1 ELSE 0 END) > 0
               THEN 'LINEの集計条件を満たさないため未取得です'
             WHEN SUM(CASE WHEN m.state = 'waiting' THEN 1 ELSE 0 END) > 0
               THEN 'LINEの集計を待っています'
             WHEN SUM(CASE WHEN m.state = 'failed' THEN 1 ELSE 0 END) > 0
               THEN 'LINEの集計を取得できませんでした'
             ELSE NULL
           END AS reason
      FROM notification_aggregate_metrics m
      JOIN customer_notification_definitions d
        ON d.id = m.definition_id AND d.line_account_id = m.line_account_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY m.definition_id, d.name
     ORDER BY d.name, m.definition_id
  `).bind(...values).all<NotificationMetricRow>();
  return result.results;
}
