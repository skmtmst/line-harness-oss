import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@line-crm/db', () => ({
  getIncomingWebhooks: vi.fn(),
  getIncomingWebhookById: vi.fn(),
  createIncomingWebhook: vi.fn(),
  updateIncomingWebhook: vi.fn(),
  deleteIncomingWebhook: vi.fn(),
  getOutgoingWebhooks: vi.fn(),
  getOutgoingWebhookById: vi.fn(),
  createOutgoingWebhook: vi.fn(),
  updateOutgoingWebhook: vi.fn(),
  deleteOutgoingWebhook: vi.fn(),
  createWebhookInteraction: vi.fn(),
  finishWebhookInteraction: vi.fn(),
  getWebhookInteractionById: vi.fn(),
  listFailedWebhookInteractionsForRetry: vi.fn(),
  listWebhookInteractions: vi.fn(),
  getOutgoingWebhookDeliverySummaries: vi.fn(),
  updateIncomingWebhookConfig: vi.fn(),
  updateIncomingWebhookMaskedSample: vi.fn(),
}));

vi.mock('../services/webhook-interactions.js', () => ({
  retryWebhookInteraction: vi.fn(),
  webhookFailureLabel: vi.fn((reason: string | null) => reason ? '安全な失敗理由' : null),
  webhookResponseLabel: vi.fn((row: { status: string }) => row.status === 'failed' ? '処理できませんでした' : '届きました'),
}));

// Stub fireEvent to keep receive-endpoint tests focused on signature
// verification rather than the full event-bus + DB graph.
vi.mock('../services/event-bus.js', () => ({
  fireEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/incoming-webhook-actions.js', () => ({
  executeIncomingWebhookActions: vi.fn().mockResolvedValue({
    matchedFriendId: null, executed: 0, failed: 0,
  }),
}));

vi.mock('../services/outgoing-webhook-delivery.js', () => ({
  deliverWebhook: vi.fn().mockResolvedValue({ ok: true, attempts: 1, lastStatus: 204 }),
}));

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn().mockResolvedValue(true),
}));

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
  getOutgoingWebhookDeliverySummaries,
  updateIncomingWebhookConfig,
  updateIncomingWebhookMaskedSample,
} from '@line-crm/db';
import { retryWebhookInteraction } from '../services/webhook-interactions.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { fireEvent } from '../services/event-bus.js';
import { executeIncomingWebhookActions } from '../services/incoming-webhook-actions.js';
import { deliverWebhook } from '../services/outgoing-webhook-delivery.js';
import type { Env } from '../index.js';
import { webhooks } from './webhooks.js';

const VALID_SECRET = 'a'.repeat(32);
const SHORT_SECRET = 'a'.repeat(31);
const ACCOUNT_ID = 'account-a';

const incomingWebhookRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'iwh-1',
  name: 'test',
  source_type: 'custom',
  secret: VALID_SECRET,
  is_active: 1,
  line_account_id: ACCOUNT_ID,
  version: 1,
  identity_match_json: '{"methods":[],"onNotFound":"do_nothing"}',
  action_refs_json: '[]',
  latest_masked_sample_json: null,
  latest_received_at: null,
  created_at: '2026-05-08T00:00:00.000+09:00',
  updated_at: '2026-05-08T00:00:00.000+09:00',
  ...overrides,
});

function setupApp(
  tenantId?: string,
  role: 'owner' | 'admin' | 'staff' = 'owner',
  permissionKeys?: string[],
) {
  const app = new Hono<Env>();
  // Webhook の作成・更新・削除はオーナー限定になった。ここで見たいのは
  // 入力の検証なので、認証は通った状態にしてから本体へ渡す。
  // 権限そのものの検証は middleware/role-guard.test.ts にある。
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1', name: 'Staff', role, readOnly: false, tenantId, permissionKeys,
    });
    return next();
  });
  app.route('/', webhooks);
  return app;
}

const baseEnv = { DB: {} as D1Database } as Record<string, unknown>;

async function webhookSignature(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(VALID_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(canAccessAllLineAccounts).mockResolvedValue(true);
  vi.mocked(createWebhookInteraction).mockResolvedValue({
    id: 'interaction-1', line_account_id: ACCOUNT_ID, direction: 'incoming',
    webhook_id: 'iwh-1', webhook_name: 'test', event_type: 'incoming_webhook.custom',
    trigger_summary: 'testから受け取った', status: 'pending', request_body_json: null,
    response_status: null, attempt_count: 0, duration_ms: null, failure_reason: null,
    idempotency_key: 'delivery-1', retry_of_id: null,
    started_at: '2026-05-08T00:00:00.000+09:00', completed_at: null,
    created_at: '2026-05-08T00:00:00.000+09:00',
  });
  vi.mocked(finishWebhookInteraction).mockResolvedValue(undefined);
  vi.mocked(listWebhookInteractions).mockResolvedValue({
    items: [], total: 0, page: 1, limit: 20,
    summary: { total: 0, outgoing: 0, incoming: 0, succeeded: 0, failed: 0, averageDurationMs: null },
  });
  vi.mocked(listFailedWebhookInteractionsForRetry).mockResolvedValue([]);
  vi.mocked(getOutgoingWebhookDeliverySummaries).mockResolvedValue([]);
  vi.mocked(updateIncomingWebhookMaskedSample).mockResolvedValue(undefined);
  vi.mocked(executeIncomingWebhookActions).mockResolvedValue({
    matchedFriendId: null, executed: 0, failed: 0,
  });
  vi.mocked(deliverWebhook).mockResolvedValue({ ok: true, attempts: 1, lastStatus: 204 });
  vi.mocked(getIncomingWebhookById).mockResolvedValue(incomingWebhookRow());
  vi.mocked(getOutgoingWebhookById).mockResolvedValue({
    id: 'wh-1', name: 'test', url: 'https://example.com/hook', event_types: '["*"]',
    secret: VALID_SECRET, is_active: 1, max_retries: 0, consecutive_failures: 0,
    last_failed_at: null, created_at: '2026-05-08', updated_at: '2026-05-08',
  });
});

// =====================================================
// POST /api/webhooks/outgoing — validation
// =====================================================

describe('POST /api/webhooks/outgoing — validation', () => {
  test('rejects missing secret with 400', async () => {
    const app = setupApp();
    const res = await app.request(
      '/api/webhooks/outgoing',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', url: 'https://example.com/hook', eventTypes: ['*'] }),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(createOutgoingWebhook).not.toHaveBeenCalled();
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/secret/i);
  });

  test('rejects secret shorter than 32 chars with 400', async () => {
    const app = setupApp();
    const res = await app.request(
      '/api/webhooks/outgoing',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test',
          url: 'https://example.com/hook',
          eventTypes: ['*'],
          secret: SHORT_SECRET,
        }),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(createOutgoingWebhook).not.toHaveBeenCalled();
  });

  test('rejects http:// URL with 400', async () => {
    const app = setupApp();
    const res = await app.request(
      '/api/webhooks/outgoing',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test',
          url: 'http://example.com/hook',
          eventTypes: ['*'],
          secret: VALID_SECRET,
          lineAccountId: ACCOUNT_ID,
        }),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(createOutgoingWebhook).not.toHaveBeenCalled();
  });

  test('rejects malformed URL with 400', async () => {
    const app = setupApp();
    const res = await app.request(
      '/api/webhooks/outgoing',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test',
          url: 'not-a-url',
          eventTypes: ['*'],
          secret: VALID_SECRET,
        }),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(createOutgoingWebhook).not.toHaveBeenCalled();
  });

  test('accepts https:// + 32-char secret with 201, returns secret only on create', async () => {
    vi.mocked(createOutgoingWebhook).mockResolvedValue({
      id: 'wh-1',
      name: 'test',
      url: 'https://example.com/hook',
      event_types: '["*"]',
      secret: VALID_SECRET,
      is_active: 1,
      max_retries: 0,
      consecutive_failures: 0,
      last_failed_at: null,
      created_at: '2026-05-08T00:00:00.000+09:00',
      updated_at: '2026-05-08T00:00:00.000+09:00',
    });

    const app = setupApp();
    const res = await app.request(
      '/api/webhooks/outgoing',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test',
          url: 'https://example.com/hook',
          eventTypes: ['*'],
          secret: VALID_SECRET,
          lineAccountId: ACCOUNT_ID,
        }),
      },
      baseEnv,
    );
    expect(res.status).toBe(201);
    expect(createOutgoingWebhook).toHaveBeenCalledOnce();
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; secret: string; name: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.secret).toBe(VALID_SECRET);
    expect(body.data.id).toBe('wh-1');
    expect(createOutgoingWebhook).toHaveBeenCalledWith(baseEnv.DB, expect.objectContaining({ lineAccountId: ACCOUNT_ID }));
  });

  test('既定でない統括はLINEアカウントを省略できない', async () => {
    const res = await setupApp('tenant-b').request('/api/webhooks/outgoing', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test', url: 'https://example.com/hook', secret: VALID_SECRET }),
    }, baseEnv);
    expect(res.status).toBe(400);
    expect((await res.json()) as object).toMatchObject({ error: 'LINEアカウントを選択してください' });
    expect(createOutgoingWebhook).not.toHaveBeenCalled();
  });

  test('他統括のLINEアカウントは403にする', async () => {
    vi.mocked(canAccessAllLineAccounts).mockResolvedValue(false);
    const res = await setupApp('tenant-b').request('/api/webhooks/outgoing', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test', url: 'https://example.com/hook', secret: VALID_SECRET, lineAccountId: 'account-a' }),
    }, baseEnv);
    expect(res.status).toBe(403);
    expect(createOutgoingWebhook).not.toHaveBeenCalled();
  });
});

// =====================================================
// PUT /api/webhooks/outgoing/:id — validation
// =====================================================

describe('PUT /api/webhooks/outgoing/:id — validation', () => {
  test('見えない行は404で更新しない', async () => {
    vi.mocked(getOutgoingWebhookById).mockResolvedValue(null);
    const res = await setupApp('tenant-b').request(`/api/webhooks/outgoing/other?lineAccountId=${ACCOUNT_ID}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://changed.example.com', secret: 'z'.repeat(32) }),
    }, baseEnv);
    expect(res.status).toBe(404);
    expect(updateOutgoingWebhook).not.toHaveBeenCalled();
  });
  test('rejects updating to http:// URL with 400', async () => {
    const app = setupApp();
    const res = await app.request(
      `/api/webhooks/outgoing/wh-1?lineAccountId=${ACCOUNT_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://evil.example.com/' }),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(updateOutgoingWebhook).not.toHaveBeenCalled();
  });

  test('rejects updating secret to fewer than 32 chars with 400', async () => {
    const app = setupApp();
    const res = await app.request(
      `/api/webhooks/outgoing/wh-1?lineAccountId=${ACCOUNT_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: SHORT_SECRET }),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(updateOutgoingWebhook).not.toHaveBeenCalled();
  });

  test('rejects truthy non-boolean isActive with 400 (migration bypass)', async () => {
    const app = setupApp();
    const res = await app.request(
      `/api/webhooks/outgoing/wh-legacy?lineAccountId=${ACCOUNT_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: 1 }),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(updateOutgoingWebhook).not.toHaveBeenCalled();
    expect(getOutgoingWebhookById).toHaveBeenCalledWith(
      baseEnv.DB,
      'wh-legacy',
      ACCOUNT_ID,
    );
  });

  test('rejects re-activating webhook whose stored secret is too short (migration bypass)', async () => {
    vi.mocked(getOutgoingWebhookById).mockResolvedValue({
      id: 'wh-legacy',
      name: 'legacy',
      url: 'https://example.com/hook',
      event_types: '["*"]',
      secret: null,
      is_active: 0,
      max_retries: 0,
      consecutive_failures: 0,
      last_failed_at: null,
      created_at: '2026-05-08T00:00:00.000+09:00',
      updated_at: '2026-05-08T00:00:00.000+09:00',
    });

    const app = setupApp();
    const res = await app.request(
      `/api/webhooks/outgoing/wh-legacy?lineAccountId=${ACCOUNT_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(updateOutgoingWebhook).not.toHaveBeenCalled();
  });

  test('rejects re-activating webhook whose stored URL is http:// (migration bypass)', async () => {
    vi.mocked(getOutgoingWebhookById).mockResolvedValue({
      id: 'wh-legacy-http',
      name: 'legacy-http',
      url: 'http://example.com/hook',
      event_types: '["*"]',
      secret: VALID_SECRET,
      is_active: 0,
      max_retries: 0,
      consecutive_failures: 0,
      last_failed_at: null,
      created_at: '2026-05-08T00:00:00.000+09:00',
      updated_at: '2026-05-08T00:00:00.000+09:00',
    });

    const app = setupApp();
    const res = await app.request(
      `/api/webhooks/outgoing/wh-legacy-http?lineAccountId=${ACCOUNT_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(updateOutgoingWebhook).not.toHaveBeenCalled();
  });

  test('accepts partial update without secret/url change', async () => {
    vi.mocked(getOutgoingWebhookById).mockResolvedValue({
      id: 'wh-1',
      name: 'renamed',
      url: 'https://example.com/hook',
      event_types: '["*"]',
      secret: VALID_SECRET,
      is_active: 1,
      max_retries: 0,
      consecutive_failures: 0,
      last_failed_at: null,
      created_at: '2026-05-08T00:00:00.000+09:00',
      updated_at: '2026-05-08T00:00:00.000+09:00',
    });

    const app = setupApp();
    const res = await app.request(
      `/api/webhooks/outgoing/wh-1?lineAccountId=${ACCOUNT_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'renamed' }),
      },
      baseEnv,
    );
    expect(res.status).toBe(200);
    expect(updateOutgoingWebhook).toHaveBeenCalledOnce();
  });
});

describe('DELETE /api/webhooks/outgoing/:id — tenant scope', () => {
  test.each(['other-tenant', 'missing'])('%s は404で削除しない', async () => {
    vi.mocked(getOutgoingWebhookById).mockResolvedValue(null);
    const res = await setupApp('tenant-b').request(`/api/webhooks/outgoing/hidden?lineAccountId=${ACCOUNT_ID}`, { method: 'DELETE' }, baseEnv);
    expect(res.status).toBe(404);
    expect(deleteOutgoingWebhook).not.toHaveBeenCalled();
  });
});

// =====================================================
// GET /api/webhooks/outgoing — secret must NOT be exposed
// =====================================================

describe('GET /api/webhooks/outgoing — secret exposure', () => {
  test('does not include secret in response payload', async () => {
    vi.mocked(getOutgoingWebhooks).mockResolvedValue([
      {
        id: 'wh-1',
        name: 'test',
        url: 'https://example.com/hook',
        event_types: '["*"]',
        secret: VALID_SECRET,
        is_active: 1,
        max_retries: 0,
        consecutive_failures: 0,
        last_failed_at: null,
        created_at: '2026-05-08T00:00:00.000+09:00',
        updated_at: '2026-05-08T00:00:00.000+09:00',
      },
    ]);

    const app = setupApp();
    const res = await app.request(`/api/webhooks/outgoing?lineAccountId=${ACCOUNT_ID}`, { method: 'GET' }, baseEnv);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(VALID_SECRET);
    const body = JSON.parse(text) as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).not.toHaveProperty('secret');
    // Caller should be told a secret IS configured, just not its value
    expect(body.data[0].hasSecret).toBe(true);
  });

  test('hasSecret is false when secret is null in DB', async () => {
    vi.mocked(getOutgoingWebhooks).mockResolvedValue([
      {
        id: 'wh-2',
        name: 'legacy',
        url: 'https://example.com/hook',
        event_types: '["*"]',
        secret: null,
        is_active: 0,
        max_retries: 0,
        consecutive_failures: 0,
        last_failed_at: null,
        created_at: '2026-05-08T00:00:00.000+09:00',
        updated_at: '2026-05-08T00:00:00.000+09:00',
      },
    ]);

    const app = setupApp();
    const res = await app.request(`/api/webhooks/outgoing?lineAccountId=${ACCOUNT_ID}`, { method: 'GET' }, baseEnv);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).not.toHaveProperty('secret');
    expect(body.data[0].hasSecret).toBe(false);
  });

  test('接続ごとの直近30日集計と、安全に再送できるかを返す', async () => {
    vi.mocked(getOutgoingWebhooks).mockResolvedValue([{
      id: 'wh-1', name: '顧客管理', url: 'https://example.com/hook', event_types: '["friend.added"]',
      secret: VALID_SECRET, is_active: 1, max_retries: 2, consecutive_failures: 1,
      last_failed_at: '2026-09-06T10:00:00.000+09:00',
      created_at: '2026-05-08T00:00:00.000+09:00', updated_at: '2026-09-06T10:00:00.000+09:00',
    }]);
    vi.mocked(getOutgoingWebhookDeliverySummaries).mockResolvedValue([{
      webhook_id: 'wh-1', total: 4, succeeded: 3, failed: 1, pending: 0,
      last_status: 'failed', last_response_status: 500,
      last_completed_at: '2026-09-06T10:00:01.000+09:00',
      last_failure_reason: 'response_5xx', can_retry: 1,
    }]);

    const res = await setupApp().request(
      `/api/webhooks/outgoing?lineAccountId=${ACCOUNT_ID}`,
      { method: 'GET' },
      baseEnv,
    );
    expect(res.status).toBe(200);
    expect(getOutgoingWebhookDeliverySummaries).toHaveBeenCalledWith(baseEnv.DB, ACCOUNT_ID, 30);
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).toMatchObject({
      deliverySummary: {
        periodDays: 30, total: 4, succeeded: 3, failed: 1, pending: 0,
        successRate: 75, canRetry: true,
        lastResult: { status: 'failed', responseStatus: 500, failureReason: '安全な失敗理由' },
      },
    });
  });

  test('履歴がない接続は0件・成功率未計算として返す', async () => {
    vi.mocked(getOutgoingWebhooks).mockResolvedValue([{
      id: 'wh-empty', name: '未送信', url: 'https://example.com/empty', event_types: '["*"]',
      secret: VALID_SECRET, is_active: 1, max_retries: 0, consecutive_failures: 0,
      last_failed_at: null, created_at: '2026-05-08', updated_at: '2026-05-08',
    }]);

    const res = await setupApp().request(
      `/api/webhooks/outgoing?lineAccountId=${ACCOUNT_ID}`,
      { method: 'GET' },
      baseEnv,
    );
    const body = await res.json() as { data: Array<{ deliverySummary: Record<string, unknown> }> };
    expect(body.data[0].deliverySummary).toMatchObject({
      total: 0, succeeded: 0, failed: 0, pending: 0, successRate: null,
      lastResult: null, canRetry: false,
    });
  });

  test('対象外アカウントの集計を読めない', async () => {
    vi.mocked(canAccessAllLineAccounts).mockResolvedValue(false);
    const res = await setupApp().request(
      '/api/webhooks/outgoing?lineAccountId=account-b',
      { method: 'GET' },
      baseEnv,
    );
    expect(res.status).toBe(403);
    expect(getOutgoingWebhookDeliverySummaries).not.toHaveBeenCalled();
  });

  test('集計取得に失敗したら安全な500を返す', async () => {
    vi.mocked(getOutgoingWebhookDeliverySummaries).mockRejectedValue(new Error('private DB detail'));
    const res = await setupApp().request(
      `/api/webhooks/outgoing?lineAccountId=${ACCOUNT_ID}`,
      { method: 'GET' },
      baseEnv,
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('private DB detail');
  });
});

// =====================================================
// POST /api/webhooks/incoming — validation
// =====================================================

describe('POST /api/webhooks/incoming — validation', () => {
  test('requires an account outside the default tenant and checks an explicit account', async () => {
    const app = setupApp('tenant-b');
    const omitted = await app.request('/api/webhooks/incoming', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test', secret: VALID_SECRET }),
    }, baseEnv);
    expect(omitted.status).toBe(400);

    vi.mocked(canAccessAllLineAccounts).mockResolvedValueOnce(false);
    const forbidden = await app.request('/api/webhooks/incoming', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test', secret: VALID_SECRET, lineAccountId: 'account-a' }),
    }, baseEnv);
    expect(forbidden.status).toBe(403);
    expect(canAccessAllLineAccounts).toHaveBeenCalledWith(baseEnv.DB, expect.anything(), ['account-a']);
  });

  test('rejects missing secret with 400', async () => {
    const app = setupApp();
    const res = await app.request(
      '/api/webhooks/incoming',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(createIncomingWebhook).not.toHaveBeenCalled();
  });

  test('rejects secret shorter than 32 chars with 400', async () => {
    const app = setupApp();
    const res = await app.request(
      '/api/webhooks/incoming',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', secret: SHORT_SECRET }),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(createIncomingWebhook).not.toHaveBeenCalled();
  });

  test('accepts 32-char secret with 201, returns secret on create only', async () => {
    vi.mocked(createIncomingWebhook).mockResolvedValue(incomingWebhookRow());

    const app = setupApp();
    const res = await app.request(
      '/api/webhooks/incoming',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', secret: VALID_SECRET, lineAccountId: ACCOUNT_ID }),
      },
      baseEnv,
    );
    expect(res.status).toBe(201);
    expect(createIncomingWebhook).toHaveBeenCalledOnce();
    expect(createIncomingWebhook).toHaveBeenCalledWith(baseEnv.DB, expect.objectContaining({ lineAccountId: ACCOUNT_ID }));
    const body = (await res.json()) as { data: { id: string; secret: string } };
    expect(body.data.secret).toBe(VALID_SECRET);
  });
});

// =====================================================
// PUT /api/webhooks/incoming/:id — validation
// =====================================================

describe('PUT /api/webhooks/incoming/:id — validation', () => {
  test('returns 404 before changing a webhook outside the tenant', async () => {
    vi.mocked(getIncomingWebhookById).mockResolvedValue(null);
    const res = await setupApp('tenant-b').request(`/api/webhooks/incoming/iwh-other?lineAccountId=${ACCOUNT_ID}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: VALID_SECRET }),
    }, baseEnv);
    expect(res.status).toBe(404);
    expect(updateIncomingWebhook).not.toHaveBeenCalled();
  });

  test('rejects updating secret to fewer than 32 chars with 400', async () => {
    const app = setupApp();
    const res = await app.request(
      `/api/webhooks/incoming/iwh-1?lineAccountId=${ACCOUNT_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: SHORT_SECRET }),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(updateIncomingWebhook).not.toHaveBeenCalled();
  });

  test('rejects re-activating webhook whose stored secret is too short (migration bypass)', async () => {
    vi.mocked(getIncomingWebhookById).mockResolvedValue(incomingWebhookRow({
      id: 'iwh-legacy', name: 'legacy', secret: null, is_active: 0, line_account_id: null,
    }));

    const app = setupApp();
    const res = await app.request(
      `/api/webhooks/incoming/iwh-legacy?lineAccountId=${ACCOUNT_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(updateIncomingWebhook).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/webhooks/incoming/:id — tenant scope', () => {
  test('returns 404 before deleting a webhook outside the tenant', async () => {
    vi.mocked(getIncomingWebhookById).mockResolvedValue(null);
    const res = await setupApp('tenant-b').request(`/api/webhooks/incoming/iwh-other?lineAccountId=${ACCOUNT_ID}`, { method: 'DELETE' }, baseEnv);
    expect(res.status).toBe(404);
    expect(deleteIncomingWebhook).not.toHaveBeenCalled();
  });
});

// =====================================================
// GET /api/webhooks/incoming — secret must NOT be exposed
// =====================================================

describe('GET /api/webhooks/incoming — secret exposure', () => {
  test('does not include secret in response payload', async () => {
    vi.mocked(getIncomingWebhooks).mockResolvedValue([incomingWebhookRow()]);

    const app = setupApp();
    const res = await app.request(`/api/webhooks/incoming?lineAccountId=${ACCOUNT_ID}`, { method: 'GET' }, baseEnv);
    const text = await res.text();
    expect(text).not.toContain(VALID_SECRET);
    const body = JSON.parse(text) as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).not.toHaveProperty('secret');
    expect(body.data[0].hasSecret).toBe(true);
  });
});

describe('受け取り口の詳細と設定', () => {
  test('値を隠した最新項目と構造化設定だけを返す', async () => {
    vi.mocked(getIncomingWebhookById).mockResolvedValue(incomingWebhookRow({
      version: 3,
      identity_match_json: '{"methods":[{"kind":"external_customer_id","path":"$.customer.id"}],"onNotFound":"unmatched_box"}',
      action_refs_json: '[{"refKind":"tag","refId":"tag-a","refVersionId":null}]',
      latest_masked_sample_json: '{"fields":[{"path":"$.customer.email","type":"string","maskedValue":"••••"}],"truncated":false}',
      latest_received_at: '2026-09-07T09:00:00.000+09:00',
    }));

    const res = await setupApp().request(
      `/api/webhooks/incoming/iwh-1?lineAccountId=${ACCOUNT_ID}`,
      { method: 'GET' },
      baseEnv,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(VALID_SECRET);
    const body = JSON.parse(text) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      version: 3,
      identityMatching: {
        methods: [{ kind: 'external_customer_id', path: '$.customer.id' }],
        onNotFound: 'unmatched_box',
      },
      actions: [{ refKind: 'tag', refId: 'tag-a', refVersionId: null }],
      actionExecution: { state: 'connected' },
      latestSample: {
        receivedAt: '2026-09-07T09:00:00.000+09:00',
        fields: [{ path: '$.customer.email', type: 'string', maskedValue: '••••' }],
      },
      templateFields: [{
        path: '$.customer.email', type: 'string', token: '{{payload.customer.email}}',
      }],
    });
  });

  test('受信前は最新見本と差し込み項目を空で返す', async () => {
    const res = await setupApp().request(
      `/api/webhooks/incoming/iwh-1?lineAccountId=${ACCOUNT_ID}`,
      { method: 'GET' },
      baseEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: {
        latestSample: null,
        templateFields: [],
        actionExecution: { state: 'not_configured', reason: null },
      },
    });
  });

  test('詳細取得に失敗したら顧客値を含まない500を返す', async () => {
    vi.mocked(getIncomingWebhookById).mockRejectedValue(new Error('private@example.com'));
    const res = await setupApp().request(
      `/api/webhooks/incoming/iwh-1?lineAccountId=${ACCOUNT_ID}`,
      { method: 'GET' },
      baseEnv,
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('private@example.com');
  });

  test('対象外アカウントは存在も返さない', async () => {
    vi.mocked(canAccessAllLineAccounts).mockResolvedValue(false);
    const res = await setupApp().request(
      '/api/webhooks/incoming/iwh-1?lineAccountId=account-b',
      { method: 'GET' },
      baseEnv,
    );
    expect(res.status).toBe(404);
    expect(getIncomingWebhookById).not.toHaveBeenCalled();
  });

  test('権限キーのないスタッフは詳細を読めない', async () => {
    const res = await setupApp(undefined, 'staff', []).request(
      `/api/webhooks/incoming/iwh-1?lineAccountId=${ACCOUNT_ID}`,
      { method: 'GET' },
      baseEnv,
    );
    expect(res.status).toBe(403);
    expect(getIncomingWebhookById).not.toHaveBeenCalled();
  });

  test('オーナーは版を指定して照合方法と実行参照を保存できる', async () => {
    vi.mocked(updateIncomingWebhookConfig).mockResolvedValue({
      status: 'updated', item: incomingWebhookRow({ version: 4 }),
    });
    const res = await setupApp().request(
      `/api/webhooks/incoming/iwh-1/config?lineAccountId=${ACCOUNT_ID}`,
      {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: 3,
          identityMatching: {
            methods: [{ kind: 'harness_friend_id', path: '$.friend.id' }],
            onNotFound: 'do_nothing',
          },
          actions: [{ refKind: 'scenario', refId: 'scenario-a', refVersionId: 'version-a' }],
        }),
      },
      baseEnv,
    );
    expect(res.status).toBe(200);
    expect(updateIncomingWebhookConfig).toHaveBeenCalledWith(baseEnv.DB, {
      id: 'iwh-1', lineAccountId: ACCOUNT_ID, expectedVersion: 3,
      identityMatching: {
        methods: [{ kind: 'harness_friend_id', path: '$.friend.id' }],
        onNotFound: 'do_nothing',
      },
      actions: [{ refKind: 'scenario', refId: 'scenario-a', refVersionId: 'version-a' }],
    });
  });

  test('古い版の保存は409と現在版を返す', async () => {
    vi.mocked(updateIncomingWebhookConfig).mockResolvedValue({
      status: 'conflict', currentVersion: 5,
    });
    const res = await setupApp().request(
      `/api/webhooks/incoming/iwh-1/config?lineAccountId=${ACCOUNT_ID}`,
      {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: 4,
          identityMatching: { methods: [], onNotFound: 'do_nothing' },
          actions: [],
        }),
      },
      baseEnv,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      success: false, code: 'version_conflict', data: { currentVersion: 5 },
    });
  });

  test('名前照合や自由記述アクションを受け付けない', async () => {
    const res = await setupApp().request(
      `/api/webhooks/incoming/iwh-1/config?lineAccountId=${ACCOUNT_ID}`,
      {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: 1,
          identityMatching: {
            methods: [{ kind: 'name', path: '$.name' }], onNotFound: 'do_nothing',
          },
          actions: [{ refKind: 'free_text', refId: '何かする' }],
        }),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(updateIncomingWebhookConfig).not.toHaveBeenCalled();
  });

  test('オーナー以外は設定を更新できない', async () => {
    const res = await setupApp(undefined, 'admin').request(
      `/api/webhooks/incoming/iwh-1/config?lineAccountId=${ACCOUNT_ID}`,
      {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
      baseEnv,
    );
    expect(res.status).toBe(403);
    expect(updateIncomingWebhookConfig).not.toHaveBeenCalled();
  });
});

// =====================================================
// POST /api/webhooks/incoming/:id/receive — signature verification
// =====================================================

describe('POST /api/webhooks/incoming/:id/receive — signature', () => {
  test('rejects request without X-Webhook-Signature with 401', async () => {
    vi.mocked(getIncomingWebhookById).mockResolvedValue(incomingWebhookRow({ line_account_id: null }));

    const app = setupApp();
    const res = await app.request(
      '/api/webhooks/incoming/iwh-1/receive',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ping: true }),
      },
      baseEnv,
    );
    expect(res.status).toBe(401);
  });

  test('rejects invalid signature with 401', async () => {
    vi.mocked(getIncomingWebhookById).mockResolvedValue(incomingWebhookRow({ line_account_id: null }));

    const app = setupApp();
    const res = await app.request(
      '/api/webhooks/incoming/iwh-1/receive',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': 'deadbeef',
        },
        body: JSON.stringify({ ping: true }),
      },
      baseEnv,
    );
    expect(res.status).toBe(401);
  });

  test('accepts valid HMAC-SHA256 hex signature', async () => {
    vi.mocked(getIncomingWebhookById).mockResolvedValue(incomingWebhookRow());

    const body = JSON.stringify({ ping: true });
    const hexSignature = await webhookSignature(body);

    const app = setupApp();
    const res = await app.request(
      '/api/webhooks/incoming/iwh-1/receive',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': hexSignature,
        },
        body,
      },
      baseEnv,
    );
    expect(res.status).toBe(200);
    expect(fireEvent).toHaveBeenCalledWith(
      baseEnv.DB,
      'incoming_webhook.custom',
      expect.anything(),
      undefined,
      'account-a',
    );
    expect(createWebhookInteraction).toHaveBeenCalledWith(baseEnv.DB, expect.objectContaining({
      lineAccountId: 'account-a',
      direction: 'incoming',
      requestBodyJson: null,
    }));
    expect(finishWebhookInteraction).toHaveBeenCalledWith(
      baseEnv.DB,
      'interaction-1',
      'account-a',
      expect.objectContaining({ status: 'succeeded', responseStatus: 200 }),
    );
    expect(updateIncomingWebhookMaskedSample).toHaveBeenCalledWith(
      baseEnv.DB,
      'iwh-1',
      ACCOUNT_ID,
      {
        fields: [{ path: '$.ping', type: 'boolean', maskedValue: '••••' }],
        truncated: false,
      },
    );
    expect(JSON.stringify(vi.mocked(updateIncomingWebhookMaskedSample).mock.calls)).not.toContain('true');
  });

  test('照合設定と実行参照を受信後の実行器へ渡す', async () => {
    vi.mocked(getIncomingWebhookById).mockResolvedValue(incomingWebhookRow({
      identity_match_json: '{"methods":[{"kind":"harness_friend_id","path":"$.friendId"}],"onNotFound":"do_nothing"}',
      action_refs_json: '[{"refKind":"tag","refId":"tag-a","refVersionId":null}]',
    }));
    vi.mocked(executeIncomingWebhookActions).mockResolvedValue({
      matchedFriendId: 'friend-a', executed: 1, failed: 0,
    });
    const body = JSON.stringify({ friendId: 'friend-a' });
    const res = await setupApp().request(
      '/api/webhooks/incoming/iwh-1/receive',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': await webhookSignature(body),
        },
        body,
      },
      baseEnv,
    );
    expect(res.status).toBe(200);
    expect(executeIncomingWebhookActions).toHaveBeenCalledWith(baseEnv.DB, expect.objectContaining({
      lineAccountId: ACCOUNT_ID,
      webhookId: 'iwh-1',
      payload: { friendId: 'friend-a' },
      actions: [{ refKind: 'tag', refId: 'tag-a', refVersionId: null }],
    }));
    expect(fireEvent).toHaveBeenCalledWith(
      baseEnv.DB,
      'incoming_webhook.custom',
      expect.objectContaining({ friendId: 'friend-a' }),
      undefined,
      ACCOUNT_ID,
    );
  });

  test('最新項目の保存が失敗しても署名済みの受信処理は止めない', async () => {
    vi.mocked(updateIncomingWebhookMaskedSample).mockRejectedValue(new Error('D1 unavailable'));
    const body = JSON.stringify({ customer: { email: 'private@example.com' } });
    const res = await setupApp().request(
      '/api/webhooks/incoming/iwh-1/receive',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': await webhookSignature(body),
        },
        body,
      },
      baseEnv,
    );
    expect(res.status).toBe(200);
    expect(fireEvent).toHaveBeenCalledOnce();
  });
});

describe('POST /api/webhooks/outgoing/:id/test', () => {
  test('アカウント内の有効な送り先へ1回試し送信して記録する', async () => {
    const res = await setupApp().request(
      `/api/webhooks/outgoing/wh-1/test?lineAccountId=${ACCOUNT_ID}`,
      { method: 'POST' },
      baseEnv,
    );
    expect(res.status).toBe(200);
    expect(deliverWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wh-1' }),
      expect.stringContaining('webhook.test'),
      { idempotencyKey: 'interaction-1' },
    );
    expect(finishWebhookInteraction).toHaveBeenCalledWith(
      baseEnv.DB, 'interaction-1', ACCOUNT_ID,
      expect.objectContaining({ status: 'succeeded', responseStatus: 204 }),
    );
  });
});

describe('Webhookやり取り記録', () => {
  const failedRow = {
    id: 'run-a', line_account_id: ACCOUNT_ID, direction: 'outgoing' as const,
    webhook_id: 'wh-1', webhook_name: '顧客管理', event_type: 'friend.added',
    trigger_summary: '友だちが追加されたとき', status: 'failed' as const,
    request_body_json: '{"private":"本文"}', response_status: 500,
    attempt_count: 2, duration_ms: 820, failure_reason: 'response_5xx' as const,
    idempotency_key: 'delivery-a', retry_of_id: null,
    started_at: '2026-08-29T10:00:00.000+09:00', completed_at: '2026-08-29T10:00:00.820+09:00',
    created_at: '2026-08-29T10:00:00.000+09:00',
  };

  test('一覧はアカウントを検査し、本文・配送ID・Webhook IDを返さない', async () => {
    vi.mocked(listWebhookInteractions).mockResolvedValue({
      items: [failedRow], total: 1, page: 1, limit: 20,
      summary: { total: 1, outgoing: 1, incoming: 0, succeeded: 0, failed: 1, averageDurationMs: 820 },
    });
    const res = await setupApp().request(
      `/api/webhooks/interactions?lineAccountId=${ACCOUNT_ID}`,
      { method: 'GET' },
      baseEnv,
    );
    expect(res.status).toBe(200);
    expect(canAccessAllLineAccounts).toHaveBeenCalledWith(baseEnv.DB, expect.anything(), [ACCOUNT_ID]);
    const body = await res.json() as { data: { items: Array<Record<string, unknown>> } };
    expect(body.data.items[0]).toMatchObject({
      id: 'run-a', webhookName: '顧客管理', responseLabel: '処理できませんでした', canRetry: true,
    });
    expect(body.data.items[0]).not.toHaveProperty('request_body_json');
    expect(body.data.items[0]).not.toHaveProperty('idempotency_key');
    expect(body.data.items[0]).not.toHaveProperty('webhook_id');
  });

  test('権限外のアカウントは一覧を読めない', async () => {
    vi.mocked(canAccessAllLineAccounts).mockResolvedValue(false);
    const res = await setupApp().request(
      '/api/webhooks/interactions?lineAccountId=account-b',
      { method: 'GET' },
      baseEnv,
    );
    expect(res.status).toBe(403);
    expect(listWebhookInteractions).not.toHaveBeenCalled();
  });

  test('失敗した送信だけを同じアカウントの中でやり直す', async () => {
    vi.mocked(getWebhookInteractionById).mockResolvedValue(failedRow);
    vi.mocked(retryWebhookInteraction).mockResolvedValue({ ...failedRow, id: 'retry-a', status: 'succeeded' });
    const res = await setupApp().request(
      `/api/webhooks/interactions/run-a/retry?lineAccountId=${ACCOUNT_ID}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      baseEnv,
    );
    expect(res.status).toBe(200);
    expect(getWebhookInteractionById).toHaveBeenCalledWith(baseEnv.DB, 'run-a', ACCOUNT_ID);
    expect(retryWebhookInteraction).toHaveBeenCalledWith(baseEnv.DB, failedRow);
  });
});

// =====================================================
// #506 中: 壊れた event_types の1行で一覧全体を500にしない (W2)
// =====================================================

describe('GET /api/webhooks/outgoing — broken event_types (#506 W2)', () => {
  const brokenRow = {
    id: 'wh-broken', name: '壊れた送り先', url: 'https://example.com/hook',
    event_types: '{broken-json', secret: VALID_SECRET, is_active: 1,
    max_retries: 0, consecutive_failures: 0, last_failed_at: null,
    created_at: '2026-08-01', updated_at: '2026-08-01',
  };

  test('壊れた行は空の種類で返し、一覧は 200 のまま', async () => {
    vi.mocked(getOutgoingWebhooks).mockResolvedValue([brokenRow]);
    const res = await setupApp().request(
      `/api/webhooks/outgoing?lineAccountId=${ACCOUNT_ID}`,
      { method: 'GET' },
      baseEnv,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string; eventTypes: unknown; name: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].eventTypes).toEqual([]);
    expect(body.data[0].name).toBe('壊れた送り先');
  });
});

// =====================================================
// #506 中: 一覧にも受信詳細と同じ権限境界を適用する (W4)
// =====================================================

describe('webhook 一覧の権限統一 (#506 W4)', () => {
  test('権限キーのないスタッフは受信一覧を読めない', async () => {
    const res = await setupApp(undefined, 'staff', []).request(
      `/api/webhooks/incoming?lineAccountId=${ACCOUNT_ID}`,
      { method: 'GET' },
      baseEnv,
    );
    expect(res.status).toBe(403);
    expect(getIncomingWebhooks).not.toHaveBeenCalled();
  });

  test('権限キーのないスタッフは送信一覧を読めない', async () => {
    const res = await setupApp(undefined, 'staff', []).request(
      `/api/webhooks/outgoing?lineAccountId=${ACCOUNT_ID}`,
      { method: 'GET' },
      baseEnv,
    );
    expect(res.status).toBe(403);
    expect(getOutgoingWebhooks).not.toHaveBeenCalled();
  });

  test('/webhooks 権限ありスタッフは両方の一覧を読める', async () => {
    vi.mocked(getIncomingWebhooks).mockResolvedValue([]);
    vi.mocked(getOutgoingWebhooks).mockResolvedValue([]);
    for (const path of [
      `/api/webhooks/incoming?lineAccountId=${ACCOUNT_ID}`,
      `/api/webhooks/outgoing?lineAccountId=${ACCOUNT_ID}`,
    ]) {
      const res = await setupApp(undefined, 'staff', ['/webhooks']).request(
        path, { method: 'GET' }, baseEnv,
      );
      expect(res.status).toBe(200);
    }
  });
});

// =====================================================
// #506 中: 使われない受信設定口は API 単体テストで担保する (W5)
// =====================================================

describe('PATCH /api/webhooks/incoming/:id/config (#506 W5)', () => {
  const validBody = {
    expectedVersion: 3,
    identityMatching: {
      methods: [{ kind: 'harness_friend_id', path: '$.friend.id' }],
      onNotFound: 'do_nothing',
    },
    actions: [{ refKind: 'scenario', refId: 'scenario-a', refVersionId: 'version-a' }],
  };
  const patchConfig = (body: unknown) => setupApp().request(
    `/api/webhooks/incoming/iwh-1/config?lineAccountId=${ACCOUNT_ID}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    baseEnv,
  );

  test('版の不一致は 409 と現在の版を返す', async () => {
    vi.mocked(updateIncomingWebhookConfig).mockResolvedValue({ status: 'conflict', currentVersion: 5 });
    const res = await patchConfig(validBody);
    expect(res.status).toBe(409);
    const body = await res.json() as { code: string; data: { currentVersion: number } };
    expect(body.code).toBe('version_conflict');
    expect(body.data.currentVersion).toBe(5);
  });

  test('入力不備は保存せず 400', async () => {
    const res = await patchConfig({ ...validBody, expectedVersion: 0 });
    expect(res.status).toBe(400);
    expect(updateIncomingWebhookConfig).not.toHaveBeenCalled();
  });
});
