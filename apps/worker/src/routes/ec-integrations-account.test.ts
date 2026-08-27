import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getFriend: vi.fn(),
  lineClient: vi.fn(),
}));
vi.mock('@line-crm/db', () => ({
  getLineAccountById: mocks.getAccount,
  getFriendByLineUserIdForAccount: mocks.getFriend,
  jstNow: vi.fn(() => '2026-08-28 02:00:00'),
}));
vi.mock('@line-crm/line-sdk', () => ({ LineClient: mocks.lineClient }));
vi.mock('../services/event-bus.js', () => ({ fireEvent: vi.fn(), logOutgoingMessage: vi.fn() }));
vi.mock('../services/nen-tag-sync.js', () => ({ syncNenEcTags: vi.fn(), syncNenPetTags: vi.fn() }));
vi.mock('../services/nen-engagement.js', () => ({ enqueuePostShippingFollowUps: vi.fn() }));

const { ecIntegrations } = await import('./ec-integrations.js');

async function signature(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function harness() {
  const statements: Array<{ query: string; bindings: unknown[] }> = [];
  const app = new Hono<any>();
  app.route('/', ecIntegrations);
  const db = {
    prepare(query: string) {
      const entry = { query, bindings: [] as unknown[] };
      statements.push(entry);
      const statement = {
        bind(...bindings: unknown[]) { entry.bindings = bindings; return statement; },
        async run() { return { success: true, meta: { changes: 1 } }; },
        async first() { return null; },
        async all() { return { results: [] }; },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { app, db, statements };
}

async function signedRequest(
  app: Hono<any>, db: D1Database, event: Record<string, unknown>, accountId = 'account-a',
) {
  const secret = 'a'.repeat(32);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(event);
  return app.request('/api/integrations/eccube/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-line-account-id': accountId,
      'x-nen-timestamp': timestamp,
      'x-nen-signature': `sha256=${await signature(secret, timestamp, body)}`,
    },
    body,
  }, { DB: db, ECCUBE_WEBHOOK_SECRET: secret, LINE_CHANNEL_ACCESS_TOKEN: 'default-token' });
}

const baseEvent = {
  event_id: 'event-12345678', event_type: 'ec.order.confirmed',
  occurred_at: '2026-08-28T01:00:00+09:00', customer_id: 'customer-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAccount.mockResolvedValue({ id: 'account-a', is_active: 1, channel_access_token: 'account-token' });
  mocks.getFriend.mockResolvedValue(null);
});

describe('EC-CUBE event account and identity boundary', () => {
  it('requires the destination LINE account before accepting a receipt', async () => {
    const { app, db } = harness();
    const response = await app.request('/api/integrations/eccube/events', {
      method: 'POST', body: JSON.stringify(baseEvent),
    }, { DB: db, ECCUBE_WEBHOOK_SECRET: 'a'.repeat(32) });
    expect(response.status).toBe(400);
    expect(mocks.getAccount).not.toHaveBeenCalled();
  });

  it('keeps an event without a LINE identity in the matching queue', async () => {
    const { app, db, statements } = harness();
    const response = await signedRequest(app, db, baseEvent);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ success: true, status: 'identity_pending' });
    const insert = statements.find((entry) => entry.query.includes('INSERT OR IGNORE INTO ec_events'));
    expect(insert?.query).toContain('line_account_id');
    expect(insert?.bindings).toEqual(expect.arrayContaining(['eccube:account-a', 'account-a', null]));
  });

  it('looks up a supplied LINE identity only inside the selected account', async () => {
    const { app, db } = harness();
    const lineUserId = 'U00000000000000000000000000000000';
    const response = await signedRequest(app, db, { ...baseEvent, line_user_id: lineUserId });
    expect(response.status).toBe(202);
    expect(mocks.getFriend).toHaveBeenCalledWith(db, lineUserId, 'account-a');
    expect(await response.json()).toMatchObject({ status: 'identity_pending' });
  });
});
