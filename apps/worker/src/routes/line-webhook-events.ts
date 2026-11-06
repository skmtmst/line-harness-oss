import { inputError, inputJsonBoundary } from '../lib/input-errors.js';
import { Hono } from 'hono';
import {
  getLineWebhookEvent,
  listLineWebhookEvents,
} from '@line-crm/db';
import type { LineWebhookEventStatus } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { dbFor } from '../services/db-router.js';
import { lineWebhookCanRetry, lineWebhookRecoveryView, retryLineWebhookEvent } from '../services/line-webhook-recovery.js';

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
      const accountId = c.req.query('account_id');
      if (accountId && !scope.allowedAccountIds.includes(accountId)) return c.json({ success: false, error: '対象のアカウントが見つかりません' }, 404);
      const data = await listLineWebhookEvents(db, {
        status: rawStatus as LineWebhookEventStatus | undefined,
        lineAccountIds: accountId ? [accountId] : scope.allowedAccountIds,
        includeUnassigned: !accountId && scope.canSeeUnassigned,
      });
      const visible = [];
      for (const item of data) {
        const row = {
          webhook_event_id: item.webhookEventId, line_account_id: item.lineAccountId, event_type: item.eventType,
          status: item.status, attempts: item.attempts, last_error: item.lastError,
          received_at: item.receivedAt, updated_at: item.updatedAt,
        };
        const recovery = await lineWebhookRecoveryView(db, row);
        const canRetry = !recovery && await lineWebhookCanRetry(db, row);
        visible.push({ ...item, canRetry, recoveryStatus: recovery?.status ?? null,
          recoveryLabel: recovery?.status === 'needs_review' ? '要確認' : null,
          recoveryReasonCode: recovery?.reasonCode ?? null, recoveryReason: recovery?.reason ?? null });
      }
      return c.json({ success: true, data: visible });
    } catch (error) {
      throw error;
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
    } catch (error) {
      throw error;
    }
  },
);
