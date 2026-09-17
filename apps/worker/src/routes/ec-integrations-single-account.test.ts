import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  dispatchOperatorEvent: vi.fn(),
  getAccount: vi.fn(),
  getFriend: vi.fn(),
  upsertReadModels: vi.fn(),
  attachOrderFriend: vi.fn(),
  setActionStatus: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  attachEcOrderFriend: mocks.attachOrderFriend,
  getLineAccountById: mocks.getAccount,
  getFriendByLineUserIdForAccount: mocks.getFriend,
  jstNow: vi.fn(() => '2026-09-17 12:00:00'),
  setEcActionExecutionStatus: mocks.setActionStatus,
  upsertEcEventReadModels: mocks.upsertReadModels,
}));
vi.mock('@line-crm/line-sdk', () => ({ LineClient: vi.fn() }));
vi.mock('../services/event-bus.js', () => ({ fireEvent: vi.fn(), logOutgoingMessage: vi.fn() }));
vi.mock('../services/operator-notification-dispatch.js', () => ({
  dispatchOperatorEvent: mocks.dispatchOperatorEvent,
}));
vi.mock('../services/nen-tag-sync.js', () => ({ syncNenEcTags: vi.fn(), syncNenPetTags: vi.fn() }));
vi.mock('../services/nen-engagement.js', () => ({ enqueuePostShippingFollowUps: vi.fn() }));

const { ecIntegrations } = await import('./ec-integrations.js');

async function signature(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(payload),
  ));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function harness(activeAccountIds: string[]) {
  const app = new Hono<any>();
  app.route('/', ecIntegrations);
  const db = {
    prepare(query: string) {
      const entry = { bindings: [] as unknown[] };
      const statement = {
        bind(...bindings: unknown[]) { entry.bindings = bindings; return statement; },
        async run() { return { success: true, meta: { changes: 1 } }; },
        async first() { return null; },
        async all() {
          if (query.includes('FROM line_accounts')) {
            return { results: activeAccountIds.slice(0, 2).map((id) => ({ id })) };
          }
          return { results: [] };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { app, db };
}

async function legacyRequest(app: Hono<any>, db: D1Database) {
  const secret = 'a'.repeat(32);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({
    event_id: 'event-12345678',
    event_type: 'ec.order.confirmed',
    occurred_at: '2026-09-17T11:55:00+09:00',
    customer_id: 'customer-1',
  });
  return app.request('/api/integrations/eccube/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nen-timestamp': timestamp,
      'x-nen-signature': `sha256=${await signature(secret, `${timestamp}.${body}`)}`,
    },
    body,
  }, { DB: db, ECCUBE_WEBHOOK_SECRET: secret, LINE_CHANNEL_ACCESS_TOKEN: 'default-token' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAccount.mockResolvedValue({
    id: 'account-a', is_active: 1, channel_access_token: 'account-token',
  });
  mocks.getFriend.mockResolvedValue(null);
  mocks.upsertReadModels.mockResolvedValue(undefined);
  mocks.setActionStatus.mockResolvedValue(undefined);
});

describe('legacy EC events in a single-account installation', () => {
  it('accepts a legacy signature and resolves the only active LINE account', async () => {
    const { app, db } = harness(['account-a']);
    const response = await legacyRequest(app, db);

    expect(response.status).toBe(202);
    expect(mocks.getAccount).toHaveBeenCalledWith(db, 'account-a');
    expect(mocks.upsertReadModels).toHaveBeenCalledWith(db, expect.objectContaining({
      lineAccountId: 'account-a', sourceKey: 'eccube:account-a',
    }), '2026-09-17 12:00:00');
  });

  it.each([[[]], [['account-a', 'account-b']]])(
    'requires X-Line-Account-Id unless exactly one account is active',
    async (accountIds) => {
      const { app, db } = harness(accountIds);
      const response = await legacyRequest(app, db);

      expect(response.status).toBe(400);
      expect(mocks.getAccount).not.toHaveBeenCalled();
    },
  );
});
