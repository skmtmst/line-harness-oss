import { jstNow } from './utils.js';
// 通知機能クエリヘルパー

export interface NotificationRuleRow {
  id: string;
  name: string;
  event_type: string;
  conditions: string;  // JSON
  channels: string;    // JSON配列
  line_account_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: string;
  rule_id: string | null;
  event_type: string;
  title: string;
  body: string;
  channel: string;
  status: string;
  metadata: string | null;
  line_account_id: string | null;
  category: 'error' | 'update' | 'info';
  created_at: string;
}

export interface NotificationCenterRow extends NotificationRow {
  read_at: string | null;
}

export interface NotificationCenterCounts {
  all: number;
  error: number;
  update: number;
  unread: number;
}

// --- 通知ルール ---

export async function getNotificationRules(
  db: D1Database,
  lineAccountId: string,
): Promise<NotificationRuleRow[]> {
  const result = await db.prepare(
    `SELECT * FROM notification_rules WHERE line_account_id = ? ORDER BY created_at DESC`,
  ).bind(lineAccountId).all<NotificationRuleRow>();
  return result.results;
}

export async function getNotificationRuleById(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<NotificationRuleRow | null> {
  return db.prepare(`SELECT * FROM notification_rules WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId).first<NotificationRuleRow>();
}

export async function createNotificationRule(
  db: D1Database,
  input: {
    lineAccountId: string;
    name: string;
    eventType: string;
    conditions?: Record<string, unknown>;
    channels?: string[];
  },
): Promise<NotificationRuleRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  // A rule is only a draft until the operator delivery executor is connected.
  // The legacy table defaults to active, which made a newly-saved definition
  // look live even though no recipient resolution or delivery was performed.
  await db.prepare(`INSERT INTO notification_rules
    (id, name, event_type, conditions, channels, line_account_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .bind(
      id,
      input.name,
      input.eventType,
      JSON.stringify(input.conditions ?? {}),
      JSON.stringify(input.channels ?? ['dashboard']),
      input.lineAccountId,
      now,
      now,
    ).run();
  return (await getNotificationRuleById(db, id, input.lineAccountId))!;
}

export async function updateNotificationRule(
  db: D1Database,
  id: string,
  lineAccountId: string,
  updates: Partial<{ name: string; eventType: string; conditions: Record<string, unknown>; channels: string[]; isActive: boolean }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.eventType !== undefined) { sets.push('event_type = ?'); values.push(updates.eventType); }
  if (updates.conditions !== undefined) { sets.push('conditions = ?'); values.push(JSON.stringify(updates.conditions)); }
  if (updates.channels !== undefined) { sets.push('channels = ?'); values.push(JSON.stringify(updates.channels)); }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  values.push(lineAccountId);
  await db.prepare(`UPDATE notification_rules SET ${sets.join(', ')} WHERE id = ? AND line_account_id = ?`)
    .bind(...values).run();
}

export async function deleteNotificationRule(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<void> {
  await db.prepare(`DELETE FROM notification_rules WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId).run();
}

// --- 通知 ---

export async function getNotifications(
  db: D1Database,
  opts: { lineAccountId: string; status?: string; limit?: number },
): Promise<NotificationRow[]> {
  const limit = opts.limit ?? 100;
  if (opts.status) {
    const result = await db.prepare(
      `SELECT * FROM notifications WHERE line_account_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?`,
    ).bind(opts.lineAccountId, opts.status, limit).all<NotificationRow>();
    return result.results;
  }
  const result = await db.prepare(
    `SELECT * FROM notifications WHERE line_account_id = ? ORDER BY created_at DESC LIMIT ?`,
  ).bind(opts.lineAccountId, limit).all<NotificationRow>();
  return result.results;
}

export async function createNotification(
  db: D1Database,
  input: {
    ruleId?: string;
    eventType: string;
    title: string;
    body: string;
    channel: string;
    metadata?: string;
    lineAccountId?: string | null;
    category?: 'error' | 'update' | 'info';
  },
): Promise<NotificationRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO notifications (id, rule_id, event_type, title, body, channel, metadata, line_account_id, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      input.ruleId ?? null,
      input.eventType,
      input.title,
      input.body,
      input.channel,
      input.metadata ?? null,
      input.lineAccountId ?? null,
      input.category ?? 'info',
      now,
    ).run();
  return (await db.prepare(`SELECT * FROM notifications WHERE id = ?`).bind(id).first<NotificationRow>())!;
}

export async function updateNotificationStatus(db: D1Database, id: string, status: string): Promise<void> {
  await db.prepare(`UPDATE notifications SET status = ? WHERE id = ?`).bind(status, id).run();
}

export async function getNotificationCenter(
  db: D1Database,
  input: {
    lineAccountId: string;
    staffId: string;
    category?: 'error' | 'update';
    limit?: number;
  },
): Promise<NotificationCenterRow[]> {
  const conditions = ['n.line_account_id = ?', "n.channel = 'dashboard'"];
  const values: unknown[] = [input.staffId, input.lineAccountId];
  if (input.category) {
    conditions.push('n.category = ?');
    values.push(input.category);
  }
  values.push(input.limit ?? 20);
  const result = await db.prepare(`
    SELECT n.*, r.read_at
    FROM notifications n
    LEFT JOIN staff_notification_reads r
      ON r.notification_id = n.id AND r.staff_id = ?
    WHERE ${conditions.join(' AND ')}
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT ?
  `).bind(...values).all<NotificationCenterRow>();
  return result.results;
}

export async function getNotificationCenterCounts(
  db: D1Database,
  input: { lineAccountId: string; staffId: string },
): Promise<NotificationCenterCounts> {
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS all_count,
      SUM(CASE WHEN n.category = 'error' THEN 1 ELSE 0 END) AS error_count,
      SUM(CASE WHEN n.category = 'update' THEN 1 ELSE 0 END) AS update_count,
      SUM(CASE WHEN r.notification_id IS NULL THEN 1 ELSE 0 END) AS unread_count
    FROM notifications n
    LEFT JOIN staff_notification_reads r
      ON r.notification_id = n.id AND r.staff_id = ?
    WHERE n.line_account_id = ? AND n.channel = 'dashboard'
  `).bind(input.staffId, input.lineAccountId).first<{
    all_count: number;
    error_count: number | null;
    update_count: number | null;
    unread_count: number | null;
  }>();
  return {
    all: Number(row?.all_count ?? 0),
    error: Number(row?.error_count ?? 0),
    update: Number(row?.update_count ?? 0),
    unread: Number(row?.unread_count ?? 0),
  };
}

export async function markNotificationRead(
  db: D1Database,
  input: { notificationId: string; lineAccountId: string; staffId: string },
): Promise<boolean> {
  const now = jstNow();
  const result = await db.prepare(`
    INSERT OR REPLACE INTO staff_notification_reads (notification_id, staff_id, read_at)
    SELECT id, ?, ? FROM notifications
    WHERE id = ? AND line_account_id = ? AND channel = 'dashboard'
  `).bind(input.staffId, now, input.notificationId, input.lineAccountId).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function markAllNotificationsRead(
  db: D1Database,
  input: {
    lineAccountId: string;
    staffId: string;
    category?: 'error' | 'update';
  },
): Promise<number> {
  const conditions = ['line_account_id = ?', "channel = 'dashboard'"];
  const values: unknown[] = [input.staffId, jstNow(), input.lineAccountId];
  if (input.category) {
    conditions.push('category = ?');
    values.push(input.category);
  }
  const result = await db.prepare(`
    INSERT OR REPLACE INTO staff_notification_reads (notification_id, staff_id, read_at)
    SELECT id, ?, ? FROM notifications
    WHERE ${conditions.join(' AND ')}
  `).bind(...values).run();
  return Number(result.meta.changes ?? 0);
}

/** イベントタイプに一致するアクティブな通知ルールを取得 */
export async function getActiveNotificationRulesByEvent(
  db: D1Database,
  eventType: string,
  lineAccountId: string,
): Promise<NotificationRuleRow[]> {
  const result = await db.prepare(
    `SELECT * FROM notification_rules
      WHERE event_type = ? AND line_account_id = ? AND is_active = 1`,
  ).bind(eventType, lineAccountId).all<NotificationRuleRow>();
  return result.results;
}
