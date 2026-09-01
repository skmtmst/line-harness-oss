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
} from '@line-crm/db';
import { retryWebhookInteraction } from '../services/webhook-interactions.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { fireEvent } from '../services/event-bus.js';
import type { Env } from '../index.js';
import { webhooks } from './webhooks.js';

const VALID_SECRET = 'a'.repeat(32);
const SHORT_SECRET = 'a'.repeat(31);
const ACCOUNT_ID = 'account-a';

function setupApp(tenantId?: string) {
  const app = new Hono<Env>();
  // Webhook の作成・更新・削除はオーナー限定になった。ここで見たいのは
  // 入力の検証なので、認証は通った状態にしてから本体へ渡す。
  // 権限そのものの検証は middleware/role-guard.test.ts にある。
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false, tenantId });
    return next();
  });
  app.route('/', webhooks);
  return app;
}

const baseEnv = { DB: {} as D1Database } as Record<string, unknown>;

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
  vi.mocked(getIncomingWebhookById).mockResolvedValue({
    id: 'iwh-1', name: 'test', source_type: 'custom', secret: VALID_SECRET,
    is_active: 1, line_account_id: ACCOUNT_ID, created_at: '2026-05-08', updated_at: '2026-05-08',
  });
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
    vi.mocked(createIncomingWebhook).mockResolvedValue({
      id: 'iwh-1',
      name: 'test',
      source_type: 'custom',
      secret: VALID_SECRET,
      is_active: 1,
      line_account_id: ACCOUNT_ID,
      created_at: '2026-05-08T00:00:00.000+09:00',
      updated_at: '2026-05-08T00:00:00.000+09:00',
    });

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
    vi.mocked(getIncomingWebhookById).mockResolvedValue({
      id: 'iwh-legacy',
      name: 'legacy',
      source_type: 'custom',
      secret: null,
      is_active: 0,
      line_account_id: null,
      created_at: '2026-05-08T00:00:00.000+09:00',
      updated_at: '2026-05-08T00:00:00.000+09:00',
    });

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
    vi.mocked(getIncomingWebhooks).mockResolvedValue([
      {
        id: 'iwh-1',
        name: 'test',
        source_type: 'custom',
        secret: VALID_SECRET,
        is_active: 1,
        line_account_id: ACCOUNT_ID,
        created_at: '2026-05-08T00:00:00.000+09:00',
        updated_at: '2026-05-08T00:00:00.000+09:00',
      },
    ]);

    const app = setupApp();
    const res = await app.request(`/api/webhooks/incoming?lineAccountId=${ACCOUNT_ID}`, { method: 'GET' }, baseEnv);
    const text = await res.text();
    expect(text).not.toContain(VALID_SECRET);
    const body = JSON.parse(text) as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).not.toHaveProperty('secret');
    expect(body.data[0].hasSecret).toBe(true);
  });
});

// =====================================================
// POST /api/webhooks/incoming/:id/receive — signature verification
// =====================================================

describe('POST /api/webhooks/incoming/:id/receive — signature', () => {
  test('rejects request without X-Webhook-Signature with 401', async () => {
    vi.mocked(getIncomingWebhookById).mockResolvedValue({
      id: 'iwh-1',
      name: 'test',
      source_type: 'custom',
      secret: VALID_SECRET,
      is_active: 1,
      line_account_id: null,
      created_at: '2026-05-08T00:00:00.000+09:00',
      updated_at: '2026-05-08T00:00:00.000+09:00',
    });

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
    vi.mocked(getIncomingWebhookById).mockResolvedValue({
      id: 'iwh-1',
      name: 'test',
      source_type: 'custom',
      secret: VALID_SECRET,
      is_active: 1,
      line_account_id: null,
      created_at: '2026-05-08T00:00:00.000+09:00',
      updated_at: '2026-05-08T00:00:00.000+09:00',
    });

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
    vi.mocked(getIncomingWebhookById).mockResolvedValue({
      id: 'iwh-1',
      name: 'test',
      source_type: 'custom',
      secret: VALID_SECRET,
      is_active: 1,
      line_account_id: 'account-a',
      created_at: '2026-05-08T00:00:00.000+09:00',
      updated_at: '2026-05-08T00:00:00.000+09:00',
    });

    const body = JSON.stringify({ ping: true });
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(VALID_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const hexSignature = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

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
