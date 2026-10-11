import { inputError, inputJsonBoundary } from '../lib/input-errors.js';
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
import { lineWebhookRecoveryView, retryLineWebhookEvent } from '../services/line-webhook-recovery.js';

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
        lineAccountIds: scope.allowedAccountIds,
        includeUnassigned: scope.canSeeUnassigned,
      });
      const visible = [];
      for (const item of data) {
        const recovery = await lineWebhookRecoveryView(db, {
          webhook_event_id: item.webhookEventId, line_account_id: item.lineAccountId, event_type: item.eventType,
          status: item.status, attempts: item.attempts, last_error: item.lastError,
          received_at: item.receivedAt, updated_at: item.updatedAt,
        });
        visible.push({ ...item, recoveryStatus: recovery?.status ?? null,
          recoveryLabel: recovery?.status === 'needs_review' ? '要確認' : null,
          recoveryReasonCode: recovery?.reasonCode ?? null, recoveryReason: recovery?.reason ?? null });
      }
      return c.json({ success: true, data: visible });
    } catch {
      console.error({ event: 'line_webhook_events_list_failed', reason: 'db_error' });
      return c.json({ success: false, error: 'Webhook台帳を取得できませんでした' }, 500);
    }
  },
);

lineWebhookEvents.post(
  '/api/line-webhook-events/:id/retry',
  requireRole('owner', 'admin'),
  inputJsonBoundary(), async (c) => {
    try {
      const db = dbFor(c.env);
      const scope = await getVisibleLineAccountScope(db, c.get('staff'));
      const row = await getLineWebhookEvent(db, c.req.param('id'));
      const isVisible = row && (row.line_account_id
        ? scope.allowedAccountIds.includes(row.line_account_id)
        : scope.canSeeUnassigned);
      if (!isVisible) {
        return c.json({ success: false, error: '対象のWebhookイベントが見つかりません' }, 404);
      }

      const result = await retryLineWebhookEvent({ ...c.env, DB: db }, row!);
      if (result.status === 'succeeded') return c.json({ success: true, ...result });
      return c.json({
        success: false,
        ...result,
        code: result.status === 'needs_review' ? 'WEBHOOK_REQUIRES_REVIEW' : result.status === 'busy' ? 'WEBHOOK_RETRY_BUSY' : 'WEBHOOK_RETRY_FAILED',
        error: result.status === 'needs_review' ? `要確認：${result.reason}` : result.status === 'busy' ? '処理中です。時間をおいて確認してください' : '再処理に失敗しました。保存済みの工程からもう一度再開できます',
      }, result.status === 'failed' ? 503 : 409);
    } catch {
      console.error({ event: 'line_webhook_event_retry_check_failed', reason: 'db_error' });
      return c.json({ success: false, error: 'Webhookイベントを確認できませんでした' }, 500);
    }
  },
);
