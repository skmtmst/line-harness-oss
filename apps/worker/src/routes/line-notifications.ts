import { Hono, type Context } from 'hono';
import { LineClient, type Message } from '@line-crm/line-sdk';
import {
  LineNotificationError,
  createCustomerNotificationDefinition,
  getCustomerNotificationDefinition,
  getNotificationDeliveryForRetry,
  claimNotificationDeliveryRetry,
  finishNotificationDeliveryRetry,
  listCustomerNotificationDefinitions,
  listNotificationDeliveries,
  listNotificationMetrics,
  publishCustomerNotificationDefinition,
  stopCustomerNotificationDefinition,
  updateCustomerNotificationDraft,
  type CustomerNotificationDefinitionRow,
  type CustomerNotificationVersionRow,
  type NotificationDeliveryListRow,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { auditLog } from '../lib/audit-log.js';

const lineNotifications = new Hono<Env>();

type CustomerDraft = Record<string, unknown> & {
  lineTemplate?: unknown;
  aggregationRule?: unknown;
  emailFallbackPolicy?: unknown;
};

function jsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function serializeVersion(row: CustomerNotificationVersionRow) {
  return {
    id: row.id,
    versionNumber: Number(row.version_number),
    config: jsonObject(row.config_json),
    aggregationRule: row.aggregation_rule,
    emailFallbackPolicy: row.email_fallback_policy,
    publishedBy: row.published_by,
    publishedAt: row.published_at,
  };
}

function serializeDefinition(
  row: CustomerNotificationDefinitionRow,
  versions?: CustomerNotificationVersionRow[],
) {
  return {
    id: row.id,
    lineAccountId: row.line_account_id,
    key: row.key,
    name: row.name,
    category: row.category,
    sourceEventType: row.source_event_type,
    status: row.status,
    draft: jsonObject(row.draft_config_json),
    currentVersionId: row.current_version_id,
    currentVersionNumber: row.current_version_number == null
      ? null
      : Number(row.current_version_number),
    transactionalOnly: true,
    version: Number(row.version),
    updatedAt: row.updated_at,
    ...(versions ? { versions: versions.map(serializeVersion) } : {}),
  };
}

function bodyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function bodyVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function bodyDraft(value: unknown): CustomerDraft | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as CustomerDraft
    : null;
}

async function requireAccount(c: Context<Env>, lineAccountId: string): Promise<Response | null> {
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
  }
  return null;
}

function definitionError(c: Context<Env>, error: unknown): Response | null {
  if (!(error instanceof LineNotificationError)) return null;
  if (error.code === 'not_found') {
    return c.json({ success: false, code: error.code, error: error.message }, 404);
  }
  return c.json({ success: false, code: error.code, error: error.message }, 409);
}

lineNotifications.get(
  '/api/line-notifications/customer-definitions',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) {
      return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    }
    const denied = await requireAccount(c, lineAccountId);
    if (denied) return denied;
    const rows = await listCustomerNotificationDefinitions(c.env.DB, lineAccountId);
    return c.json({ success: true, data: rows.map((row) => serializeDefinition(row)) });
  },
);

lineNotifications.get(
  '/api/line-notifications/customer-definitions/:id',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) {
      return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    }
    const denied = await requireAccount(c, lineAccountId);
    if (denied) return denied;
    const found = await getCustomerNotificationDefinition(c.env.DB, c.req.param('id'), lineAccountId);
    if (!found) return c.json({ success: false, error: 'お知らせが見つかりません' }, 404);
    return c.json({
      success: true,
      data: serializeDefinition(found.definition, found.versions),
    });
  },
);

lineNotifications.post(
  '/api/line-notifications/customer-definitions',
  requireRole('owner', 'admin'),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const lineAccountId = bodyString(body?.lineAccountId);
    const key = bodyString(body?.key);
    const name = bodyString(body?.name);
    const category = bodyString(body?.category);
    const sourceEventType = bodyString(body?.sourceEventType);
    const draft = bodyDraft(body?.draft);
    if (!lineAccountId || !key || !name || !category || !sourceEventType || !draft) {
      return c.json({ success: false, error: 'LINEアカウント、キー、名前、区分、きっかけ、下書きは必須です' }, 400);
    }
    const denied = await requireAccount(c, lineAccountId);
    if (denied) return denied;
    try {
      const created = await createCustomerNotificationDefinition(c.env.DB, {
        lineAccountId,
        key,
        name,
        category,
        sourceEventType,
        draftConfig: draft,
        staffId: c.get('staff').id,
      });
      auditLog(c, 'line_notification.definition.create', { kind: 'line_account', id: lineAccountId });
      return c.json({ success: true, data: serializeDefinition(created.definition, created.versions) }, 201);
    } catch (error) {
      const response = definitionError(c, error);
      if (response) return response;
      throw error;
    }
  },
);

lineNotifications.patch(
  '/api/line-notifications/customer-definitions/:id/draft',
  requireRole('owner', 'admin'),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const lineAccountId = bodyString(body?.lineAccountId);
    const expectedVersion = bodyVersion(body?.expectedVersion);
    const name = bodyString(body?.name);
    const category = bodyString(body?.category);
    const sourceEventType = bodyString(body?.sourceEventType);
    const draft = bodyDraft(body?.draft);
    if (!lineAccountId || !expectedVersion || !name || !category || !sourceEventType || !draft) {
      return c.json({ success: false, error: 'LINEアカウント、現在の版、名前、区分、きっかけ、下書きは必須です' }, 400);
    }
    const denied = await requireAccount(c, lineAccountId);
    if (denied) return denied;
    try {
      const updated = await updateCustomerNotificationDraft(c.env.DB, {
        id: c.req.param('id'),
        lineAccountId,
        expectedVersion,
        name,
        category,
        sourceEventType,
        draftConfig: draft,
        staffId: c.get('staff').id,
      });
      auditLog(c, 'line_notification.definition.update', { kind: 'customer_notification', id: c.req.param('id') });
      return c.json({ success: true, data: serializeDefinition(updated.definition, updated.versions) });
    } catch (error) {
      const response = definitionError(c, error);
      if (response) return response;
      throw error;
    }
  },
);

lineNotifications.post(
  '/api/line-notifications/customer-definitions/:id/publish',
  requireRole('owner', 'admin'),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const lineAccountId = bodyString(body?.lineAccountId);
    const expectedVersion = bodyVersion(body?.expectedVersion);
    if (!lineAccountId || !expectedVersion) {
      return c.json({ success: false, error: 'LINEアカウントと現在の版は必須です' }, 400);
    }
    const denied = await requireAccount(c, lineAccountId);
    if (denied) return denied;
    const current = await getCustomerNotificationDefinition(c.env.DB, c.req.param('id'), lineAccountId);
    if (!current) return c.json({ success: false, error: 'お知らせが見つかりません' }, 404);
    const draft = jsonObject(current.definition.draft_config_json) as CustomerDraft;
    if (!Array.isArray(draft.lineTemplate) || draft.lineTemplate.length === 0) {
      return c.json({ success: false, code: 'incomplete_draft', error: 'LINEで送る内容を設定してください' }, 409);
    }
    try {
      const published = await publishCustomerNotificationDefinition(c.env.DB, {
        id: c.req.param('id'), lineAccountId, expectedVersion, staffId: c.get('staff').id,
      });
      auditLog(c, 'line_notification.definition.publish', { kind: 'customer_notification', id: c.req.param('id') });
      return c.json({ success: true, data: serializeDefinition(published.definition, published.versions) });
    } catch (error) {
      const response = definitionError(c, error);
      if (response) return response;
      throw error;
    }
  },
);

lineNotifications.post(
  '/api/line-notifications/customer-definitions/:id/stop',
  requireRole('owner', 'admin'),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const lineAccountId = bodyString(body?.lineAccountId);
    const expectedVersion = bodyVersion(body?.expectedVersion);
    if (!lineAccountId || !expectedVersion) {
      return c.json({ success: false, error: 'LINEアカウントと現在の版は必須です' }, 400);
    }
    const denied = await requireAccount(c, lineAccountId);
    if (denied) return denied;
    try {
      const stopped = await stopCustomerNotificationDefinition(c.env.DB, {
        id: c.req.param('id'), lineAccountId, expectedVersion, staffId: c.get('staff').id,
      });
      auditLog(c, 'line_notification.definition.stop', { kind: 'customer_notification', id: c.req.param('id') });
      return c.json({ success: true, data: serializeDefinition(stopped.definition, stopped.versions) });
    } catch (error) {
      const response = definitionError(c, error);
      if (response) return response;
      throw error;
    }
  },
);

function publicDeliveryStatus(status: NotificationDeliveryListRow['status']) {
  if (status === 'provider_accepted') return 'accepted' as const;
  if (status === 'excluded') return 'excluded' as const;
  if (status === 'retry_wait' || status === 'failed') return 'failed' as const;
  return 'pending' as const;
}

function sourceLabel(sourceEventType: string): string {
  return sourceEventType.startsWith('ec.') || sourceEventType.startsWith('ec_') ? 'EC連携' : '共通通知';
}

function sourceMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  return jsonObject(value);
}

/** 画面と互換APIが共有する、アカウント限定の送信台帳レスポンス。 */
export async function notificationDeliveriesResponse(c: Context<Env>): Promise<Response> {
  const lineAccountId = c.req.query('lineAccountId')?.trim();
  if (!lineAccountId) {
    return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
  }
  const denied = await requireAccount(c, lineAccountId);
  if (denied) return denied;
  const rawLimit = Number(c.req.query('limit') ?? '20');
  const rawOffset = Number(c.req.query('offset') ?? '0');
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20;
  const offset = Number.isInteger(rawOffset) ? Math.max(rawOffset, 0) : 0;
  const view = c.req.query('view') ?? 'all';
  if (view !== 'all' && view !== 'failures') {
    return c.json({ success: false, error: '表示条件が正しくありません' }, 400);
  }
  const result = await listNotificationDeliveries(c.env.DB, { lineAccountId, view, limit, offset });
  return c.json({
    success: true,
    data: {
      items: result.items.map((row) => {
        const metadata = sourceMetadata(row.source_metadata_json);
        return {
          id: row.id,
          recipientType: row.audience_type,
          notificationName: row.definition_name ?? row.source_event_type,
          source: sourceLabel(row.source_event_type),
          sourceEventId: row.source_event_id,
          friendId: row.recipient_type === 'friend' ? row.recipient_id : null,
          friendName: row.friend_name,
          orderNumber: typeof metadata.orderNumber === 'string' ? metadata.orderNumber : null,
          channel: row.channel,
          status: publicDeliveryStatus(row.status),
          reason: row.error_message_safe,
          receivedAt: row.queued_at,
          acceptedAt: row.accepted_at,
          attemptCount: Number(row.attempts),
          nextRetryAt: row.next_retry_at,
          clickedAt: row.clicked_at,
          version: row.definition_version == null ? null : Number(row.definition_version),
          executionMode: row.execution_mode,
          retryAvailable: Number(row.retryable) === 1
            && (row.status === 'retry_wait' || row.status === 'failed'),
          recordVersion: Number(row.version),
          providerStatus: row.provider_status,
        };
      }),
      summary: result.summary,
      coverage: {
        source: 'notification_delivery_ledger',
        unassignedHistoricalRowsExcluded: true,
        attemptHistoryAvailable: true,
        retryAvailable: true,
      },
    },
    pagination: { total: result.total, limit, offset },
  });
}

lineNotifications.get(
  '/api/line-notifications/deliveries',
  requireRole('owner', 'admin', 'staff'),
  notificationDeliveriesResponse,
);

lineNotifications.get(
  '/api/line-notifications/metrics',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) {
      return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    }
    const denied = await requireAccount(c, lineAccountId);
    if (denied) return denied;
    const date = /^\d{4}-\d{2}-\d{2}$/;
    const from = c.req.query('from')?.trim();
    const to = c.req.query('to')?.trim();
    if ((from && !date.test(from)) || (to && !date.test(to)) || (from && to && from > to)) {
      return c.json({ success: false, error: '集計期間が正しくありません' }, 400);
    }
    const items = await listNotificationMetrics(c.env.DB, { lineAccountId, from, to });
    return c.json({
      success: true,
      data: {
        items: items.map((item) => ({
          definitionId: item.definition_id,
          notificationName: item.definition_name,
          accepted: { value: Number(item.accepted_count) },
          displayed: {
            state: item.state,
            value: item.display_count == null ? null : Number(item.display_count),
            reason: item.reason,
          },
          clicked: { value: Number(item.click_count) },
        })),
        coverage: {
          individualOpenAvailable: false,
          lineAggregateOnly: true,
          unavailableIsNull: true,
        },
      },
    });
  },
);

function isTransientLineError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|\b5\d\d\b|timeout|timed out|network|fetch|connection|socket/i.test(message);
}

lineNotifications.post(
  '/api/line-notifications/deliveries/:id/retry',
  requireRole('owner'),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const lineAccountId = bodyString(body?.lineAccountId);
    const expectedVersion = bodyVersion(body?.expectedVersion);
    if (!lineAccountId || !expectedVersion) {
      return c.json({ success: false, error: 'LINEアカウントと現在の版は必須です' }, 400);
    }
    const denied = await requireAccount(c, lineAccountId);
    if (denied) return denied;
    const delivery = await getNotificationDeliveryForRetry(c.env.DB, c.req.param('id'), lineAccountId);
    if (!delivery) return c.json({ success: false, error: '送信記録が見つかりません' }, 404);
    if (delivery.channel !== 'line' || delivery.recipient_type !== 'friend'
      || !delivery.line_user_id || !delivery.channel_access_token || !delivery.line_template_json) {
      return c.json({ success: false, code: 'retry_unavailable', error: 'この記録はLINEで再試行できません' }, 409);
    }
    if (!Number(delivery.retryable)
      || (delivery.status !== 'retry_wait' && delivery.status !== 'failed')) {
      return c.json({ success: false, code: 'retry_unavailable', error: '一時的な失敗だけ再試行できます' }, 409);
    }
    if (Number(delivery.version) !== expectedVersion
      || !await claimNotificationDeliveryRetry(c.env.DB, {
        id: delivery.id, lineAccountId, expectedVersion,
      })) {
      return c.json({ success: false, code: 'version_conflict', error: 'ほかの担当者が先に再試行しました' }, 409);
    }

    let messages: Message[];
    try {
      const parsed = JSON.parse(delivery.line_template_json) as unknown;
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('invalid template');
      messages = parsed as Message[];
    } catch {
      await finishNotificationDeliveryRetry(c.env.DB, {
        delivery,
        outcome: 'failed',
        errorCode: 'invalid_template',
        errorMessageSafe: '送信内容を確認してください',
      });
      return c.json({ success: false, code: 'invalid_template', error: '送信内容を確認してください' }, 409);
    }

    try {
      const result = await new LineClient(delivery.channel_access_token)
        .pushMessageWithRequestId(delivery.line_user_id, messages, delivery.idempotency_key);
      await finishNotificationDeliveryRetry(c.env.DB, {
        delivery,
        outcome: 'provider_accepted',
        providerRequestId: result.requestId,
      });
      auditLog(c, 'line_notification.delivery.retry', { kind: 'notification_delivery', id: delivery.id });
      return c.json({
        success: true,
        data: {
          id: delivery.id,
          status: 'accepted',
          attemptCount: Number(delivery.attempts) + 1,
          version: expectedVersion + 1,
        },
      });
    } catch (error) {
      const transient = isTransientLineError(error);
      const nextRetryAt = transient ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;
      await finishNotificationDeliveryRetry(c.env.DB, {
        delivery,
        outcome: transient ? 'retry_wait' : 'failed',
        errorCode: transient ? 'provider_temporary_error' : 'provider_permanent_error',
        errorMessageSafe: transient
          ? 'LINEへの再試行を待っています'
          : 'LINEが送信を受け付けませんでした。設定と送信内容を確認してください',
        nextRetryAt,
      });
      return c.json({
        success: false,
        code: transient ? 'retry_scheduled' : 'retry_failed',
        error: transient ? '一時的な失敗のため、再試行待ちに戻しました' : '再試行できませんでした',
      }, transient ? 503 : 422);
    }
  },
);

export { lineNotifications };
