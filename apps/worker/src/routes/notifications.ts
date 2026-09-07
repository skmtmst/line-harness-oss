import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import {
  getNotificationRules,
  getNotificationRuleById,
  createNotificationRule,
  updateNotificationRule,
  deleteNotificationRule,
  getNotifications,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';

const notifications = new Hono<Env>();

const OPERATOR_NOTIFICATION_CHANNELS = new Set(['dashboard', 'email', 'line']);

type OperatorRecipient = {
  id: string;
  name: string;
  email: string | null;
  email_verified_at: string | null;
  line_user_id: string | null;
  notification_preferences: string;
};

type OperatorRuleConditions = {
  importance?: string;
  recipientIds?: string[];
  recipientLabel?: string;
  message?: string;
  actionUrl?: string;
  dedupeMinutes?: number;
};

function jsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function ruleConditions(rule: { conditions: string }): OperatorRuleConditions {
  return jsonRecord(rule.conditions) as OperatorRuleConditions;
}

function ruleChannels(rule: { channels: string }): string[] {
  try {
    const parsed = JSON.parse(rule.channels) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string' && OPERATOR_NOTIFICATION_CHANNELS.has(value))
      : [];
  } catch {
    return [];
  }
}

async function operatorRecipients(
  db: D1Database,
  lineAccountId: string,
  recipientIds?: string[],
): Promise<OperatorRecipient[]> {
  const result = await db.prepare(`
    SELECT sm.id, sm.name, sm.email, sm.email_verified_at, sm.line_user_id,
           sm.notification_preferences
      FROM staff_members sm
      JOIN line_accounts la ON la.id = ?
     WHERE sm.is_active = 1
       AND COALESCE(sm.tenant_id, 'default') = COALESCE(la.tenant_id, 'default')
       AND (COALESCE(sm.account_scope, 'all') = 'all' OR sm.assigned_line_account_id = ?)
     ORDER BY sm.name, sm.id
  `).bind(lineAccountId, lineAccountId).all<OperatorRecipient>();
  const requested = recipientIds?.length ? new Set(recipientIds) : null;
  return (result.results ?? []).filter((recipient) => !requested || requested.has(recipient.id));
}

function recipientPreview(recipient: OperatorRecipient, channels: string[]) {
  const preferences = jsonRecord(recipient.notification_preferences);
  const operator = preferences.operator && typeof preferences.operator === 'object'
    ? preferences.operator as Record<string, unknown>
    : {};
  const line = channels.includes('line') && Boolean(recipient.line_user_id) && operator.line !== false;
  const email = channels.includes('email') && Boolean(recipient.email && recipient.email_verified_at) && operator.email !== false;
  const dashboard = channels.includes('dashboard');
  return {
    id: recipient.id,
    name: recipient.name,
    lineLinked: Boolean(recipient.line_user_id),
    emailVerified: Boolean(recipient.email && recipient.email_verified_at),
    channels: { line, email, dashboard },
    canReceive: line || email || dashboard,
  };
}

async function accountToken(db: D1Database, lineAccountId: string): Promise<string | null> {
  const row = await db.prepare(
    `SELECT channel_access_token FROM line_accounts WHERE id = ? AND is_active = 1`,
  ).bind(lineAccountId).first<{ channel_access_token: string | null }>();
  return row?.channel_access_token?.trim() || null;
}

function operatorMessage(rule: { name: string; event_type: string; conditions: string }, override?: string): string {
  const conditions = ruleConditions(rule);
  return override?.trim() || conditions.message?.trim()
    || `【運用者へのお知らせ】${rule.name}\n管理画面で内容を確認してください。`;
}

async function ensureOperatorInstance(
  db: D1Database,
  input: {
    lineAccountId: string;
    ruleId: string;
    sourceEventType: string;
    sourceEventId: string;
  },
): Promise<string> {
  const instanceId = crypto.randomUUID();
  const now = new Date().toISOString();
  const dedupeKey = `${input.ruleId}:${input.sourceEventId}`;
  try {
    await db.prepare(`
      INSERT INTO notification_instances
        (id, line_account_id, audience_type, definition_id, source_event_type,
         source_event_id, dedupe_key, status, created_at, updated_at)
      VALUES (?, ?, 'operator', ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(
      instanceId, input.lineAccountId, input.ruleId, input.sourceEventType,
      input.sourceEventId, dedupeKey, now, now,
    ).run();
    return instanceId;
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      const existing = await db.prepare(`
        SELECT id FROM notification_instances WHERE line_account_id = ? AND dedupe_key = ?
      `).bind(input.lineAccountId, dedupeKey).first<{ id: string }>();
      if (existing) return existing.id;
    }
    throw error;
  }
}

async function claimOperatorDelivery(
  db: D1Database,
  input: {
    lineAccountId: string;
    instanceId: string;
    ruleId: string;
    sourceEventId: string;
    recipientId: string;
    channel: 'line' | 'email' | 'in_app';
    executionMode: 'automatic' | 'test';
  },
): Promise<{ id: string; retryKey: string } | null> {
  const id = crypto.randomUUID();
  const retryKey = `${input.ruleId}:${input.sourceEventId}:${input.recipientId}:${input.channel}`;
  const now = new Date().toISOString();
  try {
    await db.prepare(`
      INSERT INTO notification_deliveries
        (id, line_account_id, instance_id, audience_type, recipient_type, recipient_id,
         channel, idempotency_key, status, retryable, attempts, queued_at,
         execution_mode, updated_at)
      VALUES (?, ?, ?, 'operator', 'staff', ?, ?, ?, 'pending', 0, 0, ?, ?, ?)
    `).bind(
      id, input.lineAccountId, input.instanceId, input.recipientId, input.channel,
      retryKey, now, input.executionMode, now,
    ).run();
    return { id, retryKey };
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) return null;
    throw error;
  }
}

async function finishOperatorDelivery(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    status: 'provider_accepted' | 'excluded' | 'failed';
    providerRequestId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE notification_deliveries
       SET status = ?, attempts = 1, provider_request_id = ?, provider_status = ?,
           error_code = ?, error_message_safe = ?,
           accepted_at = CASE WHEN ? = 'provider_accepted' THEN ? ELSE NULL END,
           failed_at = CASE WHEN ? = 'failed' THEN ? ELSE NULL END,
           updated_at = ?
     WHERE id = ? AND line_account_id = ? AND status = 'pending'
  `).bind(
    input.status, input.providerRequestId ?? null, input.status,
    input.errorCode ?? null, input.errorMessage ?? null,
    input.status, now, input.status, now, now, input.id, input.lineAccountId,
  ).run();
}

function serializeRule(item: Awaited<ReturnType<typeof getNotificationRuleById>> extends infer T
  ? Exclude<T, null>
  : never) {
  return {
    id: item.id,
    name: item.name,
    eventType: item.event_type,
    conditions: JSON.parse(item.conditions),
    channels: JSON.parse(item.channels),
    isActive: Boolean(item.is_active),
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function normalizeChannels(channels: unknown): string[] | null {
  if (!Array.isArray(channels) || channels.length === 0) return ['dashboard'];
  if (!channels.every((channel) => typeof channel === 'string' && OPERATOR_NOTIFICATION_CHANNELS.has(channel))) {
    return null;
  }
  return [...new Set(channels)];
}

// ========== 通知ルールCRUD ==========

notifications.get('/api/notifications/rules', requireRole('owner', 'admin'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const items = await getNotificationRules(c.env.DB, lineAccountId);
    return c.json({
      success: true,
      data: items.map((item) => serializeRule(item)),
    });
  } catch (err) {
    console.error('GET /api/notifications/rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

notifications.get('/api/notifications/rules/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const item = await getNotificationRuleById(c.env.DB, c.req.param('id'), lineAccountId);
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: serializeRule(item),
    });
  } catch (err) {
    console.error('GET /api/notifications/rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

notifications.post('/api/notifications/rules', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ lineAccountId: string; name: string; eventType: string; conditions?: Record<string, unknown>; channels?: string[] }>();
    const lineAccountId = body.lineAccountId?.trim();
    const name = body.name?.trim();
    const eventType = body.eventType?.trim();
    const channels = normalizeChannels(body.channels);
    if (!lineAccountId || !name || !eventType) {
      return c.json({ success: false, error: 'LINEアカウント、名前、きっかけは必須です' }, 400);
    }
    if (!channels) return c.json({ success: false, error: '利用できない通知方法が含まれています' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const item = await createNotificationRule(c.env.DB, {
      lineAccountId,
      name,
      eventType,
      conditions: body.conditions,
      channels,
    });
    return c.json({
      success: true,
      data: serializeRule(item),
    }, 201);
  } catch (err) {
    console.error('POST /api/notifications/rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

notifications.put('/api/notifications/rules/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      lineAccountId: string;
      name?: string;
      eventType?: string;
      conditions?: Record<string, unknown>;
      channels?: string[];
      isActive?: boolean;
    }>();
    const lineAccountId = body.lineAccountId?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (body.isActive === true) {
      return c.json({
        success: false,
        error: '受け取る人と送信処理を接続するまで、運用者へのお知らせは公開できません',
      }, 409);
    }
    const channels = body.channels === undefined ? undefined : normalizeChannels(body.channels);
    if (channels === null) return c.json({ success: false, error: '利用できない通知方法が含まれています' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const current = await getNotificationRuleById(c.env.DB, id, lineAccountId);
    if (!current) return c.json({ success: false, error: 'Not found' }, 404);
    await updateNotificationRule(c.env.DB, id, lineAccountId, {
      name: body.name,
      eventType: body.eventType,
      conditions: body.conditions,
      channels,
      isActive: body.isActive,
    });
    const updated = await getNotificationRuleById(c.env.DB, id, lineAccountId);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: serializeRule(updated),
    });
  } catch (err) {
    console.error('PUT /api/notifications/rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

notifications.delete('/api/notifications/rules/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const current = await getNotificationRuleById(c.env.DB, c.req.param('id'), lineAccountId);
    if (!current) return c.json({ success: false, error: 'Not found' }, 404);
    await deleteNotificationRule(c.env.DB, c.req.param('id'), lineAccountId);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/notifications/rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 通知一覧 ==========

notifications.get('/api/notifications', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const status = c.req.query('status') ?? undefined;
    const requestedLimit = Number(c.req.query('limit') ?? '100');
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 100;
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const items = await getNotifications(c.env.DB, { lineAccountId, status, limit });
    return c.json({
      success: true,
      data: items.map((n) => ({
        id: n.id,
        ruleId: n.rule_id,
        eventType: n.event_type,
        title: n.title,
        body: n.body,
        channel: n.channel,
        status: n.status,
        metadata: n.metadata ? JSON.parse(n.metadata) : null,
        createdAt: n.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/notifications error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { notifications };
