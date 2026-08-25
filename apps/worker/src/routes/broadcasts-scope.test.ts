import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  getBroadcastById: vi.fn(),
  createBroadcast: vi.fn(),
  updateBroadcast: vi.fn(),
  deleteBroadcast: vi.fn(),
  scope: vi.fn(),
  lineClient: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  getBroadcasts: vi.fn(),
  getBroadcastById: mocks.getBroadcastById,
  createBroadcast: mocks.createBroadcast,
  updateBroadcast: mocks.updateBroadcast,
  deleteBroadcast: mocks.deleteBroadcast,
  getLineAccountById: vi.fn(),
}));
vi.mock('../services/account-access.js', () => ({ getVisibleLineAccountScope: mocks.scope }));
vi.mock('@line-crm/line-sdk', () => ({ LineClient: mocks.lineClient }));

const { broadcasts } = await import('./broadcasts.js');

const ownBroadcast = {
  id: 'broadcast-1', title: 'notice', message_type: 'text', message_content: 'hello',
  message_bubbles_json: null, target_type: 'all', target_tag_id: null, status: 'draft',
  scheduled_at: null, sent_at: null, total_count: 0, success_count: 0,
  created_at: '2026-08-25T00:00:00+09:00', account_ids: null, dedup_priority: null,
  failed_account_ids: null, track_links: 1, line_account_id: 'own-account',
};

function app() {
  const instance = new Hono<{ Bindings: { DB: D1Database; LINE_CHANNEL_ACCESS_TOKEN: string; WORKER_URL: string } }>();
  instance.use('*', async (c, next) => {
    c.env = { DB: {} as D1Database, LINE_CHANNEL_ACCESS_TOKEN: 'default', WORKER_URL: 'https://worker.test' };
    c.set('staff' as never, { id: 'owner', name: 'Owner', role: 'owner', readOnly: false, tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', broadcasts);
  return instance;
}

function json(method: string, body?: unknown, confirmed = false) {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(confirmed ? { 'X-Confirm-Irreversible': 'broadcast-send' } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scope.mockResolvedValue({
    accounts: [], ids: ['own-account'], allowedAccountIds: ['own-account'], canSeeUnassigned: false,
  });
});

describe('broadcast tenant scope', () => {
  test('rejects create when the body account belongs to another tenant', async () => {
    const response = await app().request('/api/broadcasts', json('POST', {
      title: 'notice', messageType: 'text', messageContent: 'hello', targetType: 'all',
      lineAccountId: 'other-account',
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'このLINEアカウントを操作する権限がありません' });
    expect(mocks.createBroadcast).not.toHaveBeenCalled();
  });

  test('rejects all multi-account input when even one account is outside scope', async () => {
    const response = await app().request('/api/broadcasts/preflight', json('POST', {
      targetType: 'multi-account-dedup', accountIds: ['own-account', 'other-account'],
    }));
    expect(response.status).toBe(403);
  });

  test.each([
    ['GET', '/api/broadcasts/broadcast-1'],
    ['PUT', '/api/broadcasts/broadcast-1'],
    ['DELETE', '/api/broadcasts/broadcast-1'],
  ])('hides another tenant broadcast for %s', async (method, path) => {
    mocks.getBroadcastById.mockResolvedValue({ ...ownBroadcast, line_account_id: 'other-account' });
    const response = await app().request(path, json(method, method === 'PUT' ? {} : undefined));
    expect(response.status).toBe(404);
    expect(mocks.updateBroadcast).not.toHaveBeenCalled();
    expect(mocks.deleteBroadcast).not.toHaveBeenCalled();
  });

  test('stops another tenant broadcast before any LINE client or request is created', async () => {
    mocks.getBroadcastById.mockResolvedValue({ ...ownBroadcast, line_account_id: 'other-account' });
    const response = await app().request(
      '/api/broadcasts/broadcast-1/send', json('POST', undefined, true),
    );
    expect(response.status).toBe(404);
    expect(mocks.lineClient).not.toHaveBeenCalled();
  });

  test('allows an own-tenant broadcast to be read', async () => {
    mocks.getBroadcastById.mockResolvedValue(ownBroadcast);
    const response = await app().request('/api/broadcasts/broadcast-1');
    expect(response.status).toBe(200);
  });

  test('treats an unassigned body account according to canSeeUnassigned', async () => {
    const response = await app().request('/api/segments/count', json('POST', { conditions: { operator: 'AND', rules: [] } }));
    expect(response.status).toBe(403);
  });
});
