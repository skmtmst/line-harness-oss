import { Hono, type Context } from 'hono';
import {
  getIncomingWebhooks,
  getIncomingWebhookById,
  createIncomingWebhook,
  updateIncomingWebhook,
  deleteIncomingWebhook,
  getOutgoingWebhooks,
  getOutgoingWebhookById,
  createOutgoingWebhook,
  updateOutgoingWebhook,
  deleteOutgoingWebhook,
  createWebhookInteraction,
  finishWebhookInteraction,
  getWebhookInteractionById,
  listFailedWebhookInteractionsForRetry,
  listWebhookInteractions,
  type WebhookInteractionRow,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import {
  retryWebhookInteraction,
  webhookFailureLabel,
  webhookResponseLabel,
} from '../services/webhook-interactions.js';

const webhooks = new Hono<Env>();

/**
 * 送り直しの回数を検証する。
 *
 * 上限を5にしているのは、待ち時間を倍にしていくと6回目以降は
 * Worker の実行時間に収まらなくなるため。相手が長時間落ちている場合まで
 * 面倒を見るなら、キューに積む別の設計が要る。
 */
function readMaxRetries(raw: unknown): { ok: true; value: number } | { ok: false } {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 5) return { ok: false };
  return { ok: true, value: n };
}


const MIN_SECRET_LENGTH = 32;

function validateSecret(secret: unknown): string | null {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    return `secret must be at least ${MIN_SECRET_LENGTH} characters`;
  }
  return null;
}

function validateHttpsUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.length === 0) {
    return 'url is required';
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'url must be a valid absolute URL';
  }
  if (parsed.protocol !== 'https:') {
    return 'url must use https:// scheme';
  }
  return null;
}

// Constant-time hex-string compare to avoid timing oracles.
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function computeHmacSha256Hex(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ========== 受信Webhook ==========

webhooks.get('/api/webhooks/incoming', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const items = await getIncomingWebhooks(c.env.DB, lineAccountId);
    return c.json({
      success: true,
      data: items.map((w) => ({
        id: w.id,
        name: w.name,
        sourceType: w.source_type,
        hasSecret: Boolean(w.secret && w.secret.length >= MIN_SECRET_LENGTH),
        isActive: Boolean(w.is_active),
        createdAt: w.created_at,
        updatedAt: w.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/webhooks/incoming error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.post('/api/webhooks/incoming', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ name: string; sourceType?: string; secret?: string; lineAccountId: string }>();
    if (!body.name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }
    const secretError = validateSecret(body.secret);
    if (secretError) {
      return c.json({ success: false, error: secretError }, 400);
    }
    const lineAccountId = body.lineAccountId?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const item = await createIncomingWebhook(c.env.DB, {
      name: body.name,
      sourceType: body.sourceType,
      secret: body.secret as string,
      lineAccountId,
    });
    return c.json(
      {
        success: true,
        data: {
          id: item.id,
          name: item.name,
          sourceType: item.source_type,
          // secret is returned exactly once on create so the operator can copy it.
          // Subsequent GETs never expose it.
          secret: item.secret,
          isActive: Boolean(item.is_active),
          createdAt: item.created_at,
        },
      },
      201,
    );
  } catch (err) {
    console.error('POST /api/webhooks/incoming error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.put('/api/webhooks/incoming/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const existing = await getIncomingWebhookById(c.env.DB, id, lineAccountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{ name?: string; sourceType?: string; secret?: string; isActive?: boolean }>();
    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
      return c.json({ success: false, error: 'isActive must be a boolean' }, 400);
    }
    if (body.secret !== undefined) {
      const secretError = validateSecret(body.secret);
      if (secretError) {
        return c.json({ success: false, error: secretError }, 400);
      }
    }
    // Activation gate: never re-enable a webhook whose post-update secret
    // would still be invalid. Otherwise migration 034 can be bypassed by
    // toggling isActive without touching the legacy null/short secret.
    if (body.isActive === true) {
      const effectiveSecret = body.secret ?? existing.secret;
      if (!effectiveSecret || effectiveSecret.length < MIN_SECRET_LENGTH) {
        return c.json(
          {
            success: false,
            error: `Cannot activate webhook: secret must be at least ${MIN_SECRET_LENGTH} characters. Update the secret first.`,
          },
          400,
        );
      }
    }
    await updateIncomingWebhook(c.env.DB, id, lineAccountId, body);
    const updated = await getIncomingWebhookById(c.env.DB, id, lineAccountId);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        sourceType: updated.source_type,
        hasSecret: Boolean(updated.secret && updated.secret.length >= MIN_SECRET_LENGTH),
        isActive: Boolean(updated.is_active),
      },
    });
  } catch (err) {
    console.error('PUT /api/webhooks/incoming/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.delete('/api/webhooks/incoming/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const existing = await getIncomingWebhookById(c.env.DB, id, lineAccountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    await deleteIncomingWebhook(c.env.DB, id, lineAccountId);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/webhooks/incoming/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 送信Webhook ==========

webhooks.get('/api/webhooks/outgoing', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const items = await getOutgoingWebhooks(c.env.DB, lineAccountId);
    return c.json({
      success: true,
      data: items.map((w) => ({
        id: w.id,
        name: w.name,
        url: w.url,
        eventTypes: JSON.parse(w.event_types),
        hasSecret: Boolean(w.secret && w.secret.length >= MIN_SECRET_LENGTH),
        isActive: Boolean(w.is_active),
        maxRetries: w.max_retries ?? 0,
        consecutiveFailures: w.consecutive_failures ?? 0,
        lastFailedAt: w.last_failed_at ?? null,
        createdAt: w.created_at,
        updatedAt: w.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/webhooks/outgoing error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.post('/api/webhooks/outgoing', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      url: string;
      eventTypes?: string[];
      secret?: string;
      maxRetries?: unknown;
      lineAccountId: string;
    }>();
    if (!body.name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }
    const urlError = validateHttpsUrl(body.url);
    if (urlError) {
      return c.json({ success: false, error: urlError }, 400);
    }
    const secretError = validateSecret(body.secret);
    if (secretError) {
      return c.json({ success: false, error: secretError }, 400);
    }
    let maxRetries = 0;
    if (body.maxRetries !== undefined) {
      const parsed = readMaxRetries(body.maxRetries);
      if (!parsed.ok) {
        return c.json({ success: false, error: 'maxRetries must be an integer between 0 and 5' }, 400);
      }
      maxRetries = parsed.value;
    }
    const lineAccountId = body.lineAccountId?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const item = await createOutgoingWebhook(c.env.DB, {
      name: body.name,
      url: body.url,
      eventTypes: body.eventTypes ?? [],
      secret: body.secret as string,
      maxRetries,
      lineAccountId,
    });
    return c.json(
      {
        success: true,
        data: {
          id: item.id,
          name: item.name,
          url: item.url,
          eventTypes: JSON.parse(item.event_types),
          // Returned exactly once on create.
          secret: item.secret,
          isActive: Boolean(item.is_active),
          maxRetries: item.max_retries ?? 0,
          createdAt: item.created_at,
        },
      },
      201,
    );
  } catch (err) {
    console.error('POST /api/webhooks/outgoing error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.put('/api/webhooks/outgoing/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const existing = await getOutgoingWebhookById(c.env.DB, id, lineAccountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{
      name?: string;
      url?: string;
      eventTypes?: string[];
      secret?: string;
      isActive?: boolean;
      maxRetries?: unknown;
    }>();
    // 検証済みの値だけを別に持つ。body をそのまま書き換えると unknown のまま
    // 下流へ渡ることになる。
    let maxRetries: number | undefined;
    if (body.maxRetries !== undefined) {
      const parsed = readMaxRetries(body.maxRetries);
      if (!parsed.ok) {
        return c.json({ success: false, error: 'maxRetries must be an integer between 0 and 5' }, 400);
      }
      maxRetries = parsed.value;
    }
    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
      return c.json({ success: false, error: 'isActive must be a boolean' }, 400);
    }
    if (body.url !== undefined) {
      const urlError = validateHttpsUrl(body.url);
      if (urlError) {
        return c.json({ success: false, error: urlError }, 400);
      }
    }
    if (body.secret !== undefined) {
      const secretError = validateSecret(body.secret);
      if (secretError) {
        return c.json({ success: false, error: secretError }, 400);
      }
    }
    // Activation gate: a PUT that re-enables an outgoing webhook must leave
    // the row with both a valid secret AND an https url even after the
    // partial update. Without this, migration 034 can be bypassed by
    // sending {isActive:true} on a legacy http:// or secret-less row.
    if (body.isActive === true) {
      const effectiveSecret = body.secret ?? existing.secret;
      const effectiveUrl = body.url ?? existing.url;
      if (!effectiveSecret || effectiveSecret.length < MIN_SECRET_LENGTH) {
        return c.json(
          {
            success: false,
            error: `Cannot activate webhook: secret must be at least ${MIN_SECRET_LENGTH} characters. Update the secret first.`,
          },
          400,
        );
      }
      const urlError = validateHttpsUrl(effectiveUrl);
      if (urlError) {
        return c.json(
          { success: false, error: `Cannot activate webhook: ${urlError}` },
          400,
        );
      }
    }
    await updateOutgoingWebhook(c.env.DB, id, lineAccountId, { ...body, maxRetries });
    const updated = await getOutgoingWebhookById(c.env.DB, id, lineAccountId);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        url: updated.url,
        eventTypes: JSON.parse(updated.event_types),
        hasSecret: Boolean(updated.secret && updated.secret.length >= MIN_SECRET_LENGTH),
        isActive: Boolean(updated.is_active),
        maxRetries: updated.max_retries ?? 0,
        consecutiveFailures: updated.consecutive_failures ?? 0,
        lastFailedAt: updated.last_failed_at ?? null,
      },
    });
  } catch (err) {
    console.error('PUT /api/webhooks/outgoing/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.delete('/api/webhooks/outgoing/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを変更する権限がありません' }, 403);
    }
    const existing = await getOutgoingWebhookById(c.env.DB, id, lineAccountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    await deleteOutgoingWebhook(c.env.DB, id, lineAccountId);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/webhooks/outgoing/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

function serializeInteraction(row: WebhookInteractionRow) {
  return {
    id: row.id,
    direction: row.direction,
    webhookName: row.webhook_name,
    eventType: row.event_type,
    triggerSummary: row.trigger_summary,
    status: row.status,
    responseLabel: webhookResponseLabel(row),
    responseStatus: row.response_status,
    attemptCount: row.attempt_count,
    durationMs: row.duration_ms,
    failureReason: webhookFailureLabel(row.failure_reason),
    canRetry: row.direction === 'outgoing' && row.status === 'failed' && Boolean(row.webhook_id),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    retryOfId: row.retry_of_id,
  };
}

async function requireInteractionAccount(c: Context<Env>) {
  const lineAccountId = c.req.query('lineAccountId')?.trim();
  if (!lineAccountId) return { error: c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400) };
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
    return { error: c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403) };
  }
  return { lineAccountId };
}

// ========== 送った・受け取ったやり取りの記録 ==========

webhooks.get('/api/webhooks/interactions', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const access = await requireInteractionAccount(c);
    if ('error' in access) return access.error;
    const direction = c.req.query('direction');
    const status = c.req.query('status');
    const result = await listWebhookInteractions(c.env.DB, {
      lineAccountId: access.lineAccountId,
      periodDays: Number(c.req.query('periodDays') ?? 30),
      direction: direction === 'incoming' || direction === 'outgoing' ? direction : undefined,
      status: status === 'succeeded' || status === 'failed' ? status : undefined,
      search: c.req.query('search'),
      page: Number(c.req.query('page') ?? 1),
      limit: Number(c.req.query('limit') ?? 20),
    });
    return c.json({
      success: true,
      data: {
        items: result.items.map(serializeInteraction),
        total: result.total,
        page: result.page,
        limit: result.limit,
        summary: result.summary,
      },
    });
  } catch (err) {
    console.error('GET /api/webhooks/interactions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.post('/api/webhooks/interactions/:id/retry', requireRole('owner', 'admin'), async (c) => {
  try {
    const access = await requireInteractionAccount(c);
    if ('error' in access) return access.error;
    const original = await getWebhookInteractionById(c.env.DB, c.req.param('id'), access.lineAccountId);
    if (!original) return c.json({ success: false, error: 'Not found' }, 404);
    const retried = await retryWebhookInteraction(c.env.DB, original);
    return c.json({ success: true, data: serializeInteraction(retried) });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'retry_failed';
    if (code === 'not_retryable' || code === 'already_retried') {
      return c.json({ success: false, error: code }, 409);
    }
    if (code === 'webhook_not_found') return c.json({ success: false, error: code }, 404);
    if (code === 'webhook_inactive' || code === 'payload_unavailable') {
      return c.json({ success: false, error: code }, 400);
    }
    console.error('POST /api/webhooks/interactions/:id/retry error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.post('/api/webhooks/interactions/retry-failed', requireRole('owner', 'admin'), async (c) => {
  try {
    const access = await requireInteractionAccount(c);
    if ('error' in access) return access.error;
    // 1件につき最大6回の外部通信になる。1リクエストの外部通信上限を越えないよう5件まで。
    const failed = await listFailedWebhookInteractionsForRetry(c.env.DB, access.lineAccountId, 5);
    let succeeded = 0;
    let failedAgain = 0;
    let skipped = 0;
    await Promise.all(failed.map(async (item) => {
      try {
        const result = await retryWebhookInteraction(c.env.DB, item);
        if (result.status === 'succeeded') succeeded++;
        else failedAgain++;
      } catch {
        skipped++;
      }
    }));
    return c.json({
      success: true,
      data: { requested: failed.length, succeeded, failed: failedAgain, skipped },
    });
  } catch (err) {
    console.error('POST /api/webhooks/interactions/retry-failed error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 受信Webhookエンドポイント (外部システムからの受信) ==========

webhooks.post('/api/webhooks/incoming/:id/receive', async (c) => {
  try {
    const id = c.req.param('id');
    const wh = await getIncomingWebhookById(c.env.DB, id);
    if (!wh || !wh.is_active) {
      return c.json({ success: false, error: 'Webhook not found or inactive' }, 404);
    }
    if (!wh.secret || wh.secret.length < MIN_SECRET_LENGTH) {
      // Should never happen post-migration, but fail closed.
      return c.json({ success: false, error: 'Webhook is not configured for secure delivery' }, 503);
    }

    const signatureHeader = c.req.header('X-Webhook-Signature') ?? '';
    if (!signatureHeader) {
      return c.json({ success: false, error: 'X-Webhook-Signature header is required' }, 401);
    }

    const rawBody = await c.req.text();
    const expected = await computeHmacSha256Hex(wh.secret, rawBody);
    if (!safeEqualHex(signatureHeader.toLowerCase(), expected)) {
      return c.json({ success: false, error: 'Invalid signature' }, 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }

    const { fireEvent } = await import('../services/event-bus.js');
    const eventType = `incoming_webhook.${wh.source_type}`;
    const started = Date.now();
    let interaction: WebhookInteractionRow | null = null;
    if (wh.line_account_id) {
      try {
        interaction = await createWebhookInteraction(c.env.DB, {
          lineAccountId: wh.line_account_id,
          direction: 'incoming',
          webhookId: wh.id,
          webhookName: wh.name,
          eventType,
          triggerSummary: `${wh.name}から受け取った`,
          // 受信は送り直さないため本文を保管しない。顧客情報を台帳へ複製しない。
          requestBodyJson: null,
        });
      } catch (logError) {
        // 台帳の一時障害で、署名確認済みの受信処理まで止めない。
        console.error('受信Webhookの記録開始に失敗:', logError);
      }
    }
    try {
      await fireEvent(c.env.DB, eventType, {
        eventData: { webhookId: wh.id, source: wh.source_type, payload },
      }, undefined, wh.line_account_id ?? null);
    } catch (eventError) {
      if (interaction && wh.line_account_id) {
        try {
          await finishWebhookInteraction(c.env.DB, interaction.id, wh.line_account_id, {
            status: 'failed',
            responseStatus: 500,
            attemptCount: 1,
            durationMs: Date.now() - started,
            failureReason: 'processing_failed',
          });
        } catch (logError) {
          console.error('受信Webhookの失敗記録を更新できませんでした:', logError);
        }
      }
      throw eventError;
    }
    if (interaction && wh.line_account_id) {
      try {
        await finishWebhookInteraction(c.env.DB, interaction.id, wh.line_account_id, {
          status: 'succeeded',
          responseStatus: 200,
          attemptCount: 1,
          durationMs: Date.now() - started,
        });
      } catch (logError) {
        // 受信処理は完了している。台帳の一時障害だけで送信元へ500を返さない。
        console.error('受信Webhookの成功記録を更新できませんでした:', logError);
      }
    }

    return c.json({ success: true, data: { received: true, source: wh.source_type } });
  } catch (err) {
    console.error('POST /api/webhooks/incoming/:id/receive error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { webhooks };
