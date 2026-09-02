import { Hono } from 'hono';
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
