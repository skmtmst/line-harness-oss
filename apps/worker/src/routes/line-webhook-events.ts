import { Hono } from 'hono';
import {
  getLineWebhookEvent,
  listLineWebhookEvents,
} from '@line-crm/db';
import type { LineWebhookEventStatus } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { dbFor } from '../services/db-router.js';

const ALLOWED_STATUSES = new Set<LineWebhookEventStatus>([
  'received',
  'processing',
  'succeeded',
  'failed',
]);

export const lineWebhookEvents = new Hono<Env>();

lineWebhookEvents.get(
  '/api/line-webhook-events',
  requireRole('owner', 'admin'),
  async (c) => {
    const rawStatus = c.req.query('status');
    if (rawStatus && !ALLOWED_STATUSES.has(rawStatus as LineWebhookEventStatus)) {
      return c.json({ success: false, error: 'statusが正しくありません' }, 400);
    }

    try {
      const db = dbFor(c.env);
      const scope = await getVisibleLineAccountScope(db, c.get('staff'));
      const data = await listLineWebhookEvents(db, {
        status: rawStatus as LineWebhookEventStatus | undefined,
        lineAccountIds: scope.ids,
      });
      return c.json({ success: true, data });
    } catch {
      console.error({ event: 'line_webhook_events_list_failed', reason: 'db_error' });
      return c.json({ success: false, error: 'Webhook台帳を取得できませんでした' }, 500);
    }
  },
);

lineWebhookEvents.post(
  '/api/line-webhook-events/:id/retry',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const db = dbFor(c.env);
      const scope = await getVisibleLineAccountScope(db, c.get('staff'));
      const row = await getLineWebhookEvent(db, c.req.param('id'));
      if (!row || !row.line_account_id || !scope.ids.includes(row.line_account_id)) {
        return c.json({ success: false, error: '対象のWebhookイベントが見つかりません' }, 404);
      }

      // 個人情報を持たない設計なので、この段階では本文を使った再処理はできない。
      return c.json({
        success: false,
        code: 'WEBHOOK_PAYLOAD_UNAVAILABLE',
        error: 'Webhook本文を保存していないため、このイベントは再処理できません',
      }, 409);
    } catch {
      console.error({ event: 'line_webhook_event_retry_check_failed', reason: 'db_error' });
      return c.json({ success: false, error: 'Webhookイベントを確認できませんでした' }, 500);
    }
  },
);
