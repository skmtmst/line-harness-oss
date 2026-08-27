import { Hono } from 'hono';
import {
  getNotificationCenter,
  getNotificationCenterCounts,
  markAllNotificationsRead,
  markNotificationRead,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

const notificationCenter = new Hono<Env>();

type NotificationCategory = 'error' | 'update';

function categoryFrom(value: string | undefined): NotificationCategory | undefined | null {
  if (!value || value === 'all') return undefined;
  if (value === 'error' || value === 'update') return value;
  return null;
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  try {
    return value ? JSON.parse(value) as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function canReadAccount(
  db: D1Database,
  staff: Parameters<typeof getVisibleLineAccountScope>[1],
  lineAccountId: string,
): Promise<boolean> {
  const scope = await getVisibleLineAccountScope(db, staff);
  return scope.allowedAccountIds.includes(lineAccountId);
}

/** ダッシュボードの通知パネル。配信状態と既読状態を混ぜない。 */
notificationCenter.get('/api/notifications/center', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canReadAccount(c.env.DB, c.get('staff'), lineAccountId)) {
      return c.json({ success: false, error: 'このLINEアカウントの通知は確認できません' }, 403);
    }
    const category = categoryFrom(c.req.query('category'));
    if (category === null) return c.json({ success: false, error: '通知の種類が正しくありません' }, 400);
    const rawLimit = Number(c.req.query('limit') ?? '20');
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
      return c.json({ success: false, error: '表示件数は1〜100で指定してください' }, 400);
    }
    const staffId = c.get('staff').id;
    const [items, counts] = await Promise.all([
      getNotificationCenter(c.env.DB, { lineAccountId, staffId, category, limit: rawLimit }),
      getNotificationCenterCounts(c.env.DB, { lineAccountId, staffId }),
    ]);
    return c.json({
      success: true,
      data: {
        items: items.map((item) => ({
          id: item.id,
          eventType: item.event_type,
          category: item.category,
          title: item.title,
          body: item.body,
          metadata: parseMetadata(item.metadata),
          isRead: Boolean(item.read_at),
          createdAt: item.created_at,
        })),
        counts,
        unreadCount: counts.unread,
      },
    });
  } catch (err) {
    console.error('GET /api/notifications/center error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

notificationCenter.post(
  '/api/notifications/center/read-all',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
  try {
    const body = await c.req.json<{ lineAccountId?: string; category?: string }>();
    if (!body.lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canReadAccount(c.env.DB, c.get('staff'), body.lineAccountId)) {
      return c.json({ success: false, error: 'このLINEアカウントの通知は変更できません' }, 403);
    }
    const category = categoryFrom(body.category);
    if (category === null) return c.json({ success: false, error: '通知の種類が正しくありません' }, 400);
    const updated = await markAllNotificationsRead(c.env.DB, {
      lineAccountId: body.lineAccountId,
      staffId: c.get('staff').id,
      category,
    });
    return c.json({ success: true, data: { updated } });
  } catch (err) {
    console.error('POST /api/notifications/center/read-all error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
  },
);

notificationCenter.post(
  '/api/notifications/center/:id/read',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
  try {
    const body = await c.req.json<{ lineAccountId?: string }>();
    if (!body.lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canReadAccount(c.env.DB, c.get('staff'), body.lineAccountId)) {
      return c.json({ success: false, error: 'このLINEアカウントの通知は変更できません' }, 403);
    }
    const updated = await markNotificationRead(c.env.DB, {
      notificationId: c.req.param('id'),
      lineAccountId: body.lineAccountId,
      staffId: c.get('staff').id,
    });
    if (!updated) return c.json({ success: false, error: '通知が見つかりません' }, 404);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('POST /api/notifications/center/:id/read error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
  },
);

export { notificationCenter };
