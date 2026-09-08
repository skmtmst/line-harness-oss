import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getFriend: vi.fn(),
  pushMessage: vi.fn(),
  upsertReadModels: vi.fn(),
  attachOrderFriend: vi.fn(),
  setActionStatus: vi.fn(),
  fireEvent: vi.fn(),
  syncEcTags: vi.fn(),
  enqueueFollowUps: vi.fn(),
  syncPetProfiles: vi.fn(),
}));
vi.mock('@line-crm/db', () => ({
  attachEcOrderFriend: mocks.attachOrderFriend,
  getLineAccountById: mocks.getAccount,
  getFriendByLineUserIdForAccount: mocks.getFriend,
  jstNow: vi.fn(() => '2026-08-28 02:00:00'),
  setEcActionExecutionStatus: mocks.setActionStatus,
  upsertEcEventReadModels: mocks.upsertReadModels,
}));
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({ pushMessage: mocks.pushMessage })),
}));
vi.mock('../services/event-bus.js', () => ({
  fireEvent: mocks.fireEvent,
  logOutgoingMessage: vi.fn(),
}));
vi.mock('../services/nen-tag-sync.js', () => ({
  syncNenEcTags: mocks.syncEcTags,
  syncNenPetTags: vi.fn(),
}));
vi.mock('../services/nen-engagement.js', () => ({
  enqueuePostShippingFollowUps: mocks.enqueueFollowUps,
  syncNenPetProfiles: mocks.syncPetProfiles,
}));

const { ecIntegrations } = await import('./ec-integrations.js');

type EcRow = { id: string; status: string };

type DispatchRow = { status: string; attempt_count: number; last_error: string | null; idempotency_key: string };

function harness(opts: { notificationEnabled?: boolean } = {}) {
  const events = new Map<string, EcRow>();
  const dispatches = new Map<string, DispatchRow>();
  const app = new Hono<any>();
  app.route('/', ecIntegrations);
  const db = {
    prepare(query: string) {
      const entry = { query, bindings: [] as unknown[] };
      const statement = {
        bind(...bindings: unknown[]) { entry.bindings = bindings; return statement; },
        async run() {
          if (query.includes('INSERT INTO ec_v6_dispatches')) {
            const [eventId, subscriber, status, lastError, idempotencyKey] = entry.bindings as [
              string, string, string, string | null, string,
            ];
            const key = `${eventId}:${subscriber}`;
            const prev = dispatches.get(key);
            dispatches.set(key, {
              status,
              attempt_count: (prev?.attempt_count ?? 0) + 1,
              last_error: status === 'failed' ? lastError : null,
              idempotency_key: idempotencyKey,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (query.includes('INSERT OR IGNORE INTO ec_events')) {
            const [id, source, externalEventId] = entry.bindings as string[];
            const key = `${source}:${externalEventId}`;
            if (events.has(key)) return { success: true, meta: { changes: 0 } };
            events.set(key, { id, status: 'received' });
            return { success: true, meta: { changes: 1 } };
          }
          if (query.includes('UPDATE ec_events SET status = \'processing\'')) {
            const row = [...events.values()].find((item) => item.id === entry.bindings[1]);
            if (row && (row.status === 'received' || row.status === 'failed')) {
              row.status = 'processing';
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (query.includes('UPDATE ec_events SET friend_id = ?, status = \'processed\'')) {
            const row = [...events.values()].find((item) => item.id === entry.bindings[3]);
            if (row) row.status = 'processed';
            return { success: true, meta: { changes: 1 } };
          }
          if (query.includes('UPDATE ec_events SET friend_id = ?, status = \'skipped\'')) {
            const row = [...events.values()].find((item) => item.id === entry.bindings[3]);
            if (row) row.status = 'skipped';
            return { success: true, meta: { changes: 1 } };
          }
          if (query.includes('UPDATE ec_events SET status = \'failed\'')) {
            const row = [...events.values()].find((item) => item.id === entry.bindings[2]);
            if (row) row.status = 'failed';
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          if (query.includes('FROM ec_v6_dispatches WHERE event_id = ?')) {
            const [eventId, subscriber] = entry.bindings as string[];
            return dispatches.get(`${eventId}:${subscriber}`) ?? null;
          }
          if (query.includes('FROM ec_events WHERE source = ?')) {
            const [source, externalEventId] = entry.bindings as string[];
            return events.get(`${source}:${externalEventId}`) ?? null;
          }
          if (query.includes('FROM ec_notification_settings')) {
            if (opts.notificationEnabled === false) {
              return {
                is_enabled: 0, title_override: null, intro_text: null, outro_text: null,
                button_label: null, button_url: null, image_url: null,
              };
            }
            return null;
          }
          return null;
        },
        async all() { return { results: [] }; },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { app, db, events, dispatches };
}

async function signature(secret: string, timestamp: string, accountId: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${timestamp}.${accountId}.${body}`),
  ));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
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
      'x-nen-signature': `sha256=${await signature(secret, timestamp, accountId, body)}`,
    },
    body,
  }, { DB: db, ECCUBE_WEBHOOK_SECRET: secret, LINE_CHANNEL_ACCESS_TOKEN: 'default-token' });
}

const LINE_USER_ID = 'U00000000000000000000000000000000';
const baseEvent = {
  event_id: 'event-12345678', event_type: 'ec.order.confirmed',
  occurred_at: '2026-08-28T01:00:00+09:00', customer_id: 'customer-1',
  line_user_id: LINE_USER_ID,
  order: { number: 'NEN-1001', total: 2860, currency: 'JPY', items: [{ name: '鹿肉ミンチ', quantity: 2 }] },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsertReadModels.mockResolvedValue(undefined);
  mocks.attachOrderFriend.mockResolvedValue(undefined);
  mocks.setActionStatus.mockResolvedValue(undefined);
  mocks.syncEcTags.mockResolvedValue(undefined);
  mocks.enqueueFollowUps.mockResolvedValue(undefined);
  mocks.syncPetProfiles.mockResolvedValue(undefined);
  mocks.getAccount.mockResolvedValue({ id: 'account-a', is_active: 1, channel_access_token: 'account-token' });
  mocks.getFriend.mockResolvedValue({ id: 'friend-1', line_account_id: 'account-a', is_following: 1 });
  mocks.pushMessage.mockResolvedValue(undefined);
  mocks.fireEvent.mockResolvedValue(undefined);
});

describe('EC receipt links one normalized event to V6', () => {
  it('publishes a single V6 event with the source identity', async () => {
    const { app, db } = harness();
    const response = await signedRequest(app, db, baseEvent);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, status: 'processed' });
    expect(mocks.fireEvent).toHaveBeenCalledTimes(1);
    expect(mocks.fireEvent).toHaveBeenCalledWith(db, 'ec.order.confirmed', {
      sourceEventId: 'event-12345678',
      sourceKind: 'eccube',
      occurredAt: '2026-08-27T16:00:00.000Z',
      friendId: 'friend-1',
      eventData: expect.objectContaining({ orderNumber: 'NEN-1001', orderTotal: 2860 }),
    }, 'account-token', 'account-a');
    const [, , payload] = mocks.fireEvent.mock.calls[0] as unknown as [unknown, unknown, Record<string, unknown>];
    expect(payload).not.toHaveProperty('event_id');
    expect(payload.eventData).not.toHaveProperty('order.items');
  });

  it('does not refire V6 on a redelivered receipt', async () => {
    const { app, db } = harness();
    const first = await signedRequest(app, db, baseEvent);
    expect(first.status).toBe(200);
    const second = await signedRequest(app, db, baseEvent);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ success: true, duplicate: true });
    expect(mocks.fireEvent).toHaveBeenCalledTimes(1);
  });

  it('still publishes V6 when the transactional notice is paused', async () => {
    const { app, db } = harness({ notificationEnabled: false });
    const response = await signedRequest(app, db, baseEvent);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ success: true, status: 'skipped' });
    expect(mocks.pushMessage).not.toHaveBeenCalled();
    expect(mocks.fireEvent).toHaveBeenCalledTimes(1);
    expect(mocks.fireEvent).toHaveBeenCalledWith(
      db, 'ec.order.confirmed', expect.objectContaining({ sourceEventId: 'event-12345678' }), 'account-token', 'account-a',
    );
  });

  it('never publishes V6 for a friend of another account', async () => {
    const { app, db } = harness();
    mocks.getFriend.mockResolvedValue({ id: 'friend-9', line_account_id: 'account-b', is_following: 1 });
    const response = await signedRequest(app, db, baseEvent);
    expect(response.status).toBe(503);
    expect(mocks.fireEvent).not.toHaveBeenCalled();
  });

  it('retries a failed receipt and publishes V6 only once', async () => {
    const { app, db } = harness();
    mocks.pushMessage.mockRejectedValueOnce(new Error('LINE temporarily unavailable'));
    const failed = await signedRequest(app, db, baseEvent);
    expect(failed.status).toBe(503);
    expect(mocks.fireEvent).not.toHaveBeenCalled();
    const retried = await signedRequest(app, db, baseEvent);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ success: true, status: 'processed' });
    expect(mocks.fireEvent).toHaveBeenCalledTimes(1);
    expect(mocks.fireEvent).toHaveBeenCalledWith(
      db, 'ec.order.confirmed', expect.objectContaining({ sourceEventId: 'event-12345678' }), 'account-token', 'account-a',
    );
  });

  it('records notification and V6 rows with stable keys', async () => {
    const { app, db, dispatches, events } = harness();
    const response = await signedRequest(app, db, baseEvent);
    expect(response.status).toBe(200);
    const rowId = events.get('eccube:account-a:event-12345678')?.id;
    expect(rowId).toBeTruthy();
    expect(dispatches.get(`${rowId}:notification`)).toMatchObject({
      status: 'sent',
      attempt_count: 1,
      idempotency_key: 'eccube:account-a:event-12345678:notification',
    });
    expect(dispatches.get(`${rowId}:v6`)).toMatchObject({
      status: 'sent',
      attempt_count: 1,
      idempotency_key: 'eccube:account-a:event-12345678:v6',
    });
  });

  it('does not resend LINE when only V6 failed before the retry', async () => {
    const { app, db, dispatches, events } = harness();
    mocks.fireEvent.mockRejectedValueOnce(new Error('V6 store is busy'));
    const failed = await signedRequest(app, db, baseEvent);
    expect(failed.status).toBe(503);
    expect(mocks.pushMessage).toHaveBeenCalledTimes(1);
    const rowId = events.get('eccube:account-a:event-12345678')?.id;
    expect(dispatches.get(`${rowId}:notification`)).toMatchObject({ status: 'sent' });
    expect(dispatches.get(`${rowId}:v6`)).toMatchObject({
      status: 'failed', attempt_count: 1, last_error: 'V6 store is busy',
    });

    const retried = await signedRequest(app, db, baseEvent);
    expect(retried.status).toBe(200);
    expect(mocks.pushMessage).toHaveBeenCalledTimes(1);
    expect(mocks.fireEvent).toHaveBeenCalledTimes(2);
    expect(dispatches.get(`${rowId}:notification`)).toMatchObject({ status: 'sent', attempt_count: 1 });
    expect(dispatches.get(`${rowId}:v6`)).toMatchObject({ status: 'sent', attempt_count: 2 });
  });

  it('publishes a profile update to V6 with the source identity', async () => {
    const { app, db } = harness();
    const response = await signedRequest(app, db, {
      ...baseEvent, event_id: 'event-abcdef12', event_type: 'ec.customer.profile_updated',
    });
    expect(response.status).toBe(200);
    expect(mocks.fireEvent).toHaveBeenCalledTimes(1);
    expect(mocks.fireEvent).toHaveBeenCalledWith(
      db, 'ec.customer.profile_updated', expect.objectContaining({
        sourceEventId: 'event-abcdef12', sourceKind: 'eccube', friendId: 'friend-1',
      }), 'account-token', 'account-a',
    );
  });
});
