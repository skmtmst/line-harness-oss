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
import { auditLog } from '../lib/audit-log.js';

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
    dedupeMinutes: number;
  },
): Promise<string> {
  const instanceId = crypto.randomUUID();
  const now = new Date().toISOString();
  const windowMs = Math.max(0, input.dedupeMinutes) * 60_000;
  const dedupeKey = windowMs > 0
    ? `${input.ruleId}:${input.sourceEventType}:${Math.floor(Date.now() / windowMs)}`
    : `${input.ruleId}:${input.sourceEventId}`;
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
        SELECT id, source_event_id FROM notification_instances
         WHERE line_account_id = ? AND dedupe_key = ?
      `).bind(input.lineAccountId, dedupeKey).first<{ id: string; source_event_id: string }>();
      if (existing) {
        if (existing.source_event_id !== input.sourceEventId) {
          await db.prepare(`
            UPDATE notification_instances
               SET occurrence_count = occurrence_count + 1,
                   grouped_count = grouped_count + 1,
                   updated_at = ?
             WHERE id = ? AND line_account_id = ?
          `).bind(now, existing.id, input.lineAccountId).run();
        }
        return existing.id;
      }
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
    recipientId: string;
    channel: 'line' | 'email' | 'in_app';
    executionMode: 'automatic' | 'test';
  },
): Promise<{ id: string; retryKey: string } | null> {
  const id = crypto.randomUUID();
  const seed = `${input.ruleId}:${input.instanceId}:${input.recipientId}:${input.channel}`;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest.slice(0, 16)].map((value) => value.toString(16).padStart(2, '0')).join('');
  const retryKey = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

async function deliverOperatorRule(
  env: Env['Bindings'],
  rule: NonNullable<Awaited<ReturnType<typeof getNotificationRuleById>>>,
  recipients: OperatorRecipient[],
  input: { sourceEventId: string; message?: string; executionMode: 'automatic' | 'test' },
) {
  const channels = ruleChannels(rule);
  const conditions = ruleConditions(rule);
  const instanceId = await ensureOperatorInstance(env.DB, {
    lineAccountId: rule.line_account_id!,
    ruleId: rule.id,
    sourceEventType: rule.event_type,
    sourceEventId: input.sourceEventId,
    dedupeMinutes: input.executionMode === 'test' ? 0 : Number(conditions.dedupeMinutes ?? 0),
  });
  const token = channels.includes('line') ? await accountToken(env.DB, rule.line_account_id!) : null;
  const text = operatorMessage(rule, input.message);
  let accepted = 0;
  let excluded = 0;
  let failed = 0;
  let duplicate = 0;

  for (const recipient of recipients) {
    const preview = recipientPreview(recipient, channels);
    for (const requestedChannel of channels) {
      const channel = requestedChannel === 'dashboard' ? 'in_app' : requestedChannel as 'line' | 'email';
      const claimed = await claimOperatorDelivery(env.DB, {
        lineAccountId: rule.line_account_id!, instanceId, ruleId: rule.id,
        recipientId: recipient.id, channel,
        executionMode: input.executionMode,
      });
      if (!claimed) {
        duplicate += 1;
        continue;
      }

      if (channel === 'in_app') {
        await env.DB.prepare(`
          INSERT INTO notifications
            (id, rule_id, event_type, title, body, channel, status, metadata,
             line_account_id, category, created_at)
          VALUES (?, ?, ?, ?, ?, 'dashboard', 'sent', ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(), rule.id, rule.event_type, rule.name, text,
          JSON.stringify({ sourceEventId: input.sourceEventId, executionMode: input.executionMode }),
          rule.line_account_id, conditions.importance === 'urgent' ? 'error' : 'info',
          new Date().toISOString(),
        ).run();
        await finishOperatorDelivery(env.DB, {
          id: claimed.id, lineAccountId: rule.line_account_id!, status: 'provider_accepted',
        });
        accepted += 1;
        continue;
      }

      if (channel === 'line') {
        if (!preview.channels.line || !recipient.line_user_id || !token) {
          await finishOperatorDelivery(env.DB, {
            id: claimed.id, lineAccountId: rule.line_account_id!, status: 'excluded',
            errorCode: !token ? 'line_account_not_connected' : 'staff_line_not_connected',
            errorMessage: !token ? 'LINEアカウントの接続を確認してください' : 'スタッフがLINEログインを完了していません',
          });
          excluded += 1;
          continue;
        }
        try {
          const result = await new LineClient(token).pushMessageWithRequestId(
            recipient.line_user_id, [{ type: 'text', text }], claimed.retryKey,
          );
          await finishOperatorDelivery(env.DB, {
            id: claimed.id, lineAccountId: rule.line_account_id!, status: 'provider_accepted',
            providerRequestId: result.requestId,
          });
          accepted += 1;
        } catch {
          await finishOperatorDelivery(env.DB, {
            id: claimed.id, lineAccountId: rule.line_account_id!, status: 'failed',
            errorCode: 'line_provider_error',
            errorMessage: 'LINEが送信を受け付けませんでした',
          });
          failed += 1;
        }
        continue;
      }

      await finishOperatorDelivery(env.DB, {
        id: claimed.id, lineAccountId: rule.line_account_id!, status: 'excluded',
        errorCode: preview.channels.email ? 'email_delivery_not_connected' : 'staff_email_not_available',
        errorMessage: preview.channels.email
          ? 'メール送信経路の接続を確認してください'
          : '確認済みのメールアドレスがありません',
      });
      excluded += 1;
    }
  }

  const totals = await env.DB.prepare(`
    SELECT SUM(CASE WHEN status = 'provider_accepted' THEN 1 ELSE 0 END) AS accepted,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM notification_deliveries
     WHERE instance_id = ? AND line_account_id = ?
  `).bind(instanceId, rule.line_account_id).first<{ accepted: number | null; failed: number | null }>();
  const instanceStatus = Number(totals?.failed ?? 0) > 0
    ? 'failed'
    : Number(totals?.accepted ?? 0) > 0 ? 'completed' : 'excluded';
  await env.DB.prepare(`
    UPDATE notification_instances SET status = ?, updated_at = ?
     WHERE id = ? AND line_account_id = ?
  `).bind(instanceStatus, new Date().toISOString(), instanceId, rule.line_account_id).run();
  return { accepted, excluded, failed, duplicate };
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

notifications.get('/api/notifications/operator-rules', requireRole('owner', 'admin'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const rules = await getNotificationRules(c.env.DB, lineAccountId);
    const today = new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, 10);
    const activity = await c.env.DB.prepare(`
      SELECT i.definition_id AS rule_id,
             COUNT(DISTINCT i.id) AS occurred_today,
             SUM(CASE WHEN d.status = 'provider_accepted' THEN 1 ELSE 0 END) AS accepted_today,
             SUM(CASE WHEN d.status = 'excluded' THEN 1 ELSE 0 END) AS excluded_today,
             MAX(i.created_at) AS last_occurred_at
        FROM notification_instances i
        LEFT JOIN notification_deliveries d
          ON d.instance_id = i.id AND d.line_account_id = i.line_account_id
       WHERE i.line_account_id = ? AND i.audience_type = 'operator'
         AND date(i.created_at, '+9 hours') = ?
       GROUP BY i.definition_id
    `).bind(lineAccountId, today).all<{
      rule_id: string; occurred_today: number; accepted_today: number;
      excluded_today: number; last_occurred_at: string | null;
    }>();
    const byRule = new Map((activity.results ?? []).map((row) => [row.rule_id, row]));
    const items = await Promise.all(rules.map(async (rule) => {
      const conditions = ruleConditions(rule);
      const recipients = await operatorRecipients(c.env.DB, lineAccountId, conditions.recipientIds);
      const preview = recipients.map((recipient) => recipientPreview(recipient, ruleChannels(rule)));
      const stats = byRule.get(rule.id);
      return {
        ...serializeRule(rule),
        status: rule.is_active ? 'published' : 'draft',
        recipientCount: preview.filter((item) => item.canReceive).length,
        lineRecipientCount: preview.filter((item) => item.channels.line).length,
        occurredToday: Number(stats?.occurred_today ?? 0),
        acceptedToday: Number(stats?.accepted_today ?? 0),
        excludedToday: Number(stats?.excluded_today ?? 0),
        lastOccurredAt: stats?.last_occurred_at ?? null,
      };
    }));
    return c.json({ success: true, data: { items } });
  } catch (err) {
    console.error('GET /api/notifications/operator-rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

notifications.post('/api/notifications/operator-rules/recipients-preview', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      lineAccountId?: string; recipientIds?: string[]; channels?: string[];
    }>();
    const lineAccountId = body.lineAccountId?.trim();
    const channels = normalizeChannels(body.channels);
    if (!lineAccountId || !channels) {
      return c.json({ success: false, error: 'LINEアカウントと通知方法を確認してください' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const recipients = await operatorRecipients(c.env.DB, lineAccountId, body.recipientIds);
    const items = recipients.map((recipient) => recipientPreview(recipient, channels));
    return c.json({
      success: true,
      data: {
        items,
        summary: {
          staff: items.length,
          canReceive: items.filter((item) => item.canReceive).length,
          line: items.filter((item) => item.channels.line).length,
          email: items.filter((item) => item.channels.email).length,
          dashboard: items.filter((item) => item.channels.dashboard).length,
          unavailable: items.filter((item) => !item.canReceive).length,
        },
      },
    });
  } catch (err) {
    console.error('POST /api/notifications/operator-rules/recipients-preview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

notifications.post('/api/notifications/operator-rules/:id/publish', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ lineAccountId?: string }>();
    const lineAccountId = body.lineAccountId?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const rule = await getNotificationRuleById(c.env.DB, c.req.param('id'), lineAccountId);
    if (!rule) return c.json({ success: false, error: 'お知らせが見つかりません' }, 404);
    const conditions = ruleConditions(rule);
    if (!conditions.recipientIds?.length) {
      return c.json({ success: false, code: 'recipient_required', error: '受け取るスタッフを1人以上選んでください' }, 409);
    }
    const recipients = await operatorRecipients(c.env.DB, lineAccountId, conditions.recipientIds);
    const deliverable = recipients.map((recipient) => recipientPreview(recipient, ruleChannels(rule)))
      .filter((recipient) => recipient.canReceive);
    if (deliverable.length === 0) {
      return c.json({ success: false, code: 'recipient_unavailable', error: '現在受け取れるスタッフがいません' }, 409);
    }
    await updateNotificationRule(c.env.DB, rule.id, lineAccountId, { isActive: true });
    const updated = await getNotificationRuleById(c.env.DB, rule.id, lineAccountId);
    auditLog(c, 'operator_notification.rule.publish', { kind: 'notification_rule', id: rule.id });
    return c.json({ success: true, data: updated ? serializeRule(updated) : null });
  } catch (err) {
    console.error('POST /api/notifications/operator-rules/:id/publish error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

notifications.post('/api/notifications/operator-rules/:id/test', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ lineAccountId?: string; message?: string }>();
    const lineAccountId = body.lineAccountId?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const rule = await getNotificationRuleById(c.env.DB, c.req.param('id'), lineAccountId);
    if (!rule) return c.json({ success: false, error: 'お知らせが見つかりません' }, 404);
    const recipients = await operatorRecipients(c.env.DB, lineAccountId, [c.get('staff').id]);
    if (recipients.length === 0) {
      return c.json({ success: false, code: 'recipient_unavailable', error: '自分の受信設定を確認してください' }, 409);
    }
    const sourceEventId = `test:${c.get('staff').id}:${crypto.randomUUID()}`;
    const result = await deliverOperatorRule(c.env, rule, recipients, {
      sourceEventId, message: body.message, executionMode: 'test',
    });
    auditLog(c, 'operator_notification.rule.test', { kind: 'notification_rule', id: rule.id });
    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('POST /api/notifications/operator-rules/:id/test error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

notifications.post('/api/notifications/operator-events', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      lineAccountId?: string; eventType?: string; sourceEventId?: string; message?: string;
    }>();
    const lineAccountId = body.lineAccountId?.trim();
    const eventType = body.eventType?.trim();
    const sourceEventId = body.sourceEventId?.trim();
    if (!lineAccountId || !eventType || !sourceEventId) {
      return c.json({ success: false, error: 'LINEアカウント、きっかけ、発生元IDは必須です' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const rules = (await getNotificationRules(c.env.DB, lineAccountId))
      .filter((rule) => Boolean(rule.is_active) && rule.event_type === eventType);
    const results = [];
    for (const rule of rules) {
      const conditions = ruleConditions(rule);
      const recipients = await operatorRecipients(c.env.DB, lineAccountId, conditions.recipientIds);
      results.push({
        ruleId: rule.id,
        ...(await deliverOperatorRule(c.env, rule, recipients, {
          sourceEventId, message: body.message, executionMode: 'automatic',
        })),
      });
    }
    return c.json({ success: true, data: { rules: results } });
  } catch (err) {
    console.error('POST /api/notifications/operator-events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

notifications.get('/api/notifications/operator-deliveries.csv', requireRole('owner'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    const reason = c.req.query('reason')?.trim();
    if (!lineAccountId || !reason) {
      return c.json({ success: false, error: 'LINEアカウントと出力理由は必須です' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを出力する権限がありません' }, 403);
    }
    const rows = await c.env.DB.prepare(`
      SELECT r.name AS rule_name, i.source_event_type, d.recipient_id, sm.name AS recipient_name,
             d.channel, d.status, d.attempts, d.queued_at, d.accepted_at,
             d.error_message_safe
        FROM notification_deliveries d
        JOIN notification_instances i ON i.id = d.instance_id AND i.line_account_id = d.line_account_id
        LEFT JOIN notification_rules r ON r.id = i.definition_id AND r.line_account_id = d.line_account_id
        LEFT JOIN staff_members sm ON sm.id = d.recipient_id
       WHERE d.line_account_id = ? AND d.audience_type = 'operator'
       ORDER BY d.queued_at DESC, d.id DESC LIMIT 5000
    `).bind(lineAccountId).all<Record<string, unknown>>();
    const headings = ['お知らせ', 'きっかけ', '受け取る人', '通知方法', '状態', '試行回数', '受付日時', 'LINE API受付日時', '理由'];
    const lines = [headings, ...(rows.results ?? []).map((row) => [
      row.rule_name, row.source_event_type, row.recipient_name, row.channel,
      row.status, row.attempts, row.queued_at, row.accepted_at, row.error_message_safe,
    ])].map((row) => row.map(csvCell).join(','));
    await c.env.DB.prepare(`
      INSERT INTO operation_audit
        (id, target_kind, target_id, action, actor_id, detail_json, created_at)
      VALUES (?, 'notification_delivery', ?, 'exported', ?, ?, ?)
    `).bind(
      crypto.randomUUID(), lineAccountId, c.get('staff').id,
      JSON.stringify({ reason: reason.slice(0, 200), count: rows.results?.length ?? 0 }),
      new Date().toISOString(),
    ).run();
    auditLog(c, 'operator_notification.delivery.export', {
      kind: 'notification_delivery', id: lineAccountId,
    });
    return new Response(`\uFEFF${lines.join('\r\n')}\r\n`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="operator-notifications-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    console.error('GET /api/notifications/operator-deliveries.csv error:', err);
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
