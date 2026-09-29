/*
 * P0-4 EC の受信署名をつなぎ先ごとの鍵でも受け付ける（移行期間は全体の鍵も可）。
 *
 * つなぎ先の鍵は ec_connectors.inbound_secret_encrypted（AES-GCM 暗号化）。
 * 暗号化・復号は本物を使い、DB の口だけ差し替える。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  dispatchOperatorEvent: vi.fn(),
  getAccount: vi.fn(),
  getFriend: vi.fn(),
  lineClient: vi.fn(),
  upsertReadModels: vi.fn(),
  attachOrderFriend: vi.fn(),
  setActionStatus: vi.fn(),
  connectorRow: vi.fn(),
}));
vi.mock('@line-crm/db', async (importActual) => ({
  ...(await importActual<typeof import('@line-crm/db')>()),
  attachEcOrderFriend: mocks.attachOrderFriend,
  getLineAccountById: mocks.getAccount,
  getFriendByLineUserIdForAccount: mocks.getFriend,
  getCustomerNotificationSource: vi.fn(async () => null),
  recordCustomerEcDelivery: vi.fn(async () => undefined),
  jstNow: vi.fn(() => '2026-09-25 10:00:00'),
  setEcActionExecutionStatus: mocks.setActionStatus,
  upsertEcEventReadModels: mocks.upsertReadModels,
}));
vi.mock('@line-crm/line-sdk', () => ({ LineClient: mocks.lineClient }));
vi.mock('../services/event-bus.js', () => ({ fireEvent: vi.fn(), logOutgoingMessage: vi.fn() }));
vi.mock('../services/operator-notification-dispatch.js', () => ({ dispatchOperatorEvent: mocks.dispatchOperatorEvent }));
vi.mock('../services/nen-tag-sync.js', () => ({ syncNenEcTags: vi.fn(), syncNenPetTags: vi.fn() }));
vi.mock('../services/nen-engagement.js', () => ({ enqueuePostShippingFollowUps: vi.fn() }));

const { ecIntegrations } = await import('./ec-integrations.js');
const { encryptCredential } = await import('@line-crm/db');

const GLOBAL_SECRET = 'g'.repeat(32);
const CONNECTOR_SECRET = 'c'.repeat(40);
const ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
let connectorCipher = '';

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const event = {
  event_id: 'eccube:order:501:confirmed:v1', event_type: 'ec.order.confirmed',
  occurred_at: '2026-09-25T10:00:00+09:00', customer_id: 501,
  line_user_id: 'U' + 'a'.repeat(32),
};

function harness() {
  const app = new Hono<any>();
  app.route('/', ecIntegrations);
  const db = {
    prepare(query: string) {
      const statement = {
        bind() { return statement; },
        async run() { return { success: true, meta: { changes: 1 } }; },
        async first() {
          if (query.includes('FROM ec_connectors')) return mocks.connectorRow();
          return null;
        },
        async all() {
          if (query.includes('FROM friends f JOIN line_accounts a')) return { results: [{ id: 'account-1' }] };
          if (query.includes('FROM line_accounts') && !query.includes('JOIN')) return { results: [{ id: 'account-1' }] };
          return { results: [] };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { app, db };
}

async function postEvent(
  app: Hono<any>,
  db: D1Database,
  secret: string,
  extraHeaders: Record<string, string> = {},
  // 未設定の再現は null で渡す（undefined は既定値に置き換わるため）。
  globalSecret: string | null = GLOBAL_SECRET,
) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(event);
  const accountHeader = extraHeaders['x-line-account-id'];
  const payload = accountHeader ? `${timestamp}.${accountHeader}.${body}` : `${timestamp}.${body}`;
  return app.request('/api/integrations/eccube/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nen-timestamp': timestamp,
      'x-nen-signature': `sha256=${await hmac(secret, payload)}`,
      ...extraHeaders,
    },
    body,
  }, {
    DB: db,
    ECCUBE_WEBHOOK_SECRET: globalSecret,
    LINE_CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: 'default-token',
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  connectorCipher = await encryptCredential(CONNECTOR_SECRET, ENCRYPTION_KEY);
  mocks.connectorRow.mockResolvedValue({ inbound_secret_encrypted: connectorCipher });
  mocks.getAccount.mockResolvedValue({ id: 'account-1', is_active: 1, channel_access_token: 'token' });
  mocks.getFriend.mockResolvedValue(null);
});

describe('EC受信：つなぎ先ごとの鍵', () => {
  it('ヘッダー有りでつなぎ先の鍵の署名を受け付ける（全体の鍵が違っても）', async () => {
    const { app, db } = harness();
    const response = await postEvent(app, db, CONNECTOR_SECRET, { 'x-line-account-id': 'account-1' }, 'z'.repeat(32));
    expect(response.status).toBe(202);
  });

  it('ヘッダー有りで全体の鍵の署名も移行期間として受け付ける', async () => {
    const { app, db } = harness();
    const response = await postEvent(app, db, GLOBAL_SECRET, { 'x-line-account-id': 'account-1' });
    expect(response.status).toBe(202);
  });

  it('ヘッダー無しで全体の鍵が合わず、つなぎ先の鍵が合えば受け付ける', async () => {
    const { app, db } = harness();
    const response = await postEvent(app, db, CONNECTOR_SECRET, {}, 'z'.repeat(32));
    expect(response.status).toBe(202);
  });

  it('使える鍵が1つもないときは503にする', async () => {
    mocks.connectorRow.mockResolvedValue(null);
    const { app, db } = harness();
    const response = await postEvent(app, db, GLOBAL_SECRET, { 'x-line-account-id': 'account-1' }, null);
    expect(response.status).toBe(503);
  });

  it('どちらの鍵でも合わない署名は401にする', async () => {
    const { app, db } = harness();
    const response = await postEvent(app, db, 'q'.repeat(32), { 'x-line-account-id': 'account-1' });
    expect(response.status).toBe(401);
  });
});
