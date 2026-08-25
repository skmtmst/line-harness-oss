import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  scope: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  listLineWebhookEvents: mocks.list,
  getLineWebhookEvent: mocks.get,
}));

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: mocks.scope,
}));

import { lineWebhookEvents } from './line-webhook-events.js';

const operator = (role: AuthenticatedStaff['role']): AuthenticatedStaff => ({
  id: `${role}-1`,
  name: role,
  role,
  readOnly: false,
  tenantId: 'tenant-1',
});

function app(role: AuthenticatedStaff['role']) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', operator(role));
    return next();
  });
  instance.route('/', lineWebhookEvents);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scope.mockResolvedValue({
    accounts: [], ids: ['account-1'], allowedAccountIds: ['account-1'], canSeeUnassigned: true,
  });
  mocks.list.mockResolvedValue([]);
  mocks.get.mockResolvedValue({
    webhook_event_id: 'evt-1',
    line_account_id: 'account-1',
    event_type: 'message',
    status: 'failed',
    attempts: 1,
    last_error: 'unknown',
    received_at: '2026-08-24T12:00:00.000',
    updated_at: '2026-08-24T12:00:01.000',
  });
});

describe('LINE Webhook台帳API', () => {
  test.each(['owner', 'admin'] as const)('%sは失敗一覧を読める', async (role) => {
    mocks.list.mockResolvedValue([{
      webhookEventId: 'evt-1',
      lineAccountId: 'account-1',
      eventType: 'message',
      status: 'failed',
      attempts: 1,
      lastError: 'unknown',
      receivedAt: '2026-08-24T12:00:00.000',
      updatedAt: '2026-08-24T12:00:01.000',
    }]);
    const response = await app(role).request(
      '/api/line-webhook-events?status=failed',
      {},
      { DB: {} as D1Database } as Env['Bindings'],
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('evt-1');
    expect(text).not.toContain('lineUserId');
    expect(text).not.toContain('displayName');
    expect(text).not.toContain('messageContent');
    expect(mocks.list).toHaveBeenCalledWith(expect.anything(), {
      status: 'failed',
      lineAccountIds: ['account-1'],
    });
  });

  test('staffは一覧も再試行APIも使えない', async () => {
    const env = { DB: {} as D1Database } as Env['Bindings'];
    expect((await app('staff').request('/api/line-webhook-events?status=failed', {}, env)).status).toBe(403);
    expect((await app('staff').request('/api/line-webhook-events/evt-1/retry', { method: 'POST' }, env)).status).toBe(403);
  });

  test('再試行APIは本文を返さず、安全にcannot retryを返す', async () => {
    const response = await app('owner').request(
      '/api/line-webhook-events/evt-1/retry',
      { method: 'POST' },
      { DB: {} as D1Database } as Env['Bindings'],
    );
    expect(response.status).toBe(409);
    const text = await response.text();
    expect(text).toContain('WEBHOOK_PAYLOAD_UNAVAILABLE');
    expect(text).not.toContain('lineUserId');
    expect(text).not.toContain('messageContent');
  });
});
