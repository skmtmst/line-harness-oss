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
      data: items.map((r) => ({
        id: r.id,
        name: r.name,
        eventType: r.event_type,
        conditions: JSON.parse(r.conditions),
        channels: JSON.parse(r.channels),
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
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
      data: {
        id: item.id,
        name: item.name,
        eventType: item.event_type,
        conditions: JSON.parse(item.conditions),
        channels: JSON.parse(item.channels),
        isActive: Boolean(item.is_active),
        createdAt: item.created_at,
      },
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
    if (!lineAccountId || !body.name || !body.eventType) {
      return c.json({ success: false, error: 'LINEアカウント、名前、きっかけは必須です' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const item = await createNotificationRule(c.env.DB, { ...body, lineAccountId });
    return c.json({
      success: true,
      data: { id: item.id, name: item.name, eventType: item.event_type, channels: JSON.parse(item.channels), createdAt: item.created_at },
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
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const current = await getNotificationRuleById(c.env.DB, id, lineAccountId);
    if (!current) return c.json({ success: false, error: 'Not found' }, 404);
    await updateNotificationRule(c.env.DB, id, lineAccountId, {
      name: body.name,
      eventType: body.eventType,
      conditions: body.conditions,
      channels: body.channels,
      isActive: body.isActive,
    });
    const updated = await getNotificationRuleById(c.env.DB, id, lineAccountId);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: { id: updated.id, name: updated.name, eventType: updated.event_type, channels: JSON.parse(updated.channels), isActive: Boolean(updated.is_active) },
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
