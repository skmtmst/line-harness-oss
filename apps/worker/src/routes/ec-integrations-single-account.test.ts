/*
 * EC-CUBE → LINE のイベント受け口で `X-Line-Account-Id` が無いとき。
 *
 * EC-CUBE 側（LineCommerceEventService::deliverPending）はこのヘッダーを送らず、
 * 署名も `timestamp.body` で作る。動いている LINE アカウントが 1 つだけの構成では
 * 旧形式の署名を確かめたうえで、本文の line_user_id が友だちとして 1 つのアカウントに見つかればそのアカウント宛て、
 * 見つからなければ動いているアカウントが 1 つだけのときだけそのアカウント宛て。決められなければ 400。
 * 検証環境で「標準の EC→LINE 自動送信が 400 になる」問題（2026-09-16）を塞ぐ。
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
}));
vi.mock('@line-crm/db', () => ({
  attachEcOrderFriend: mocks.attachOrderFriend,
  getLineAccountById: mocks.getAccount,
  getFriendByLineUserIdForAccount: mocks.getFriend,
  jstNow: vi.fn(() => '2026-09-17 02:00:00'),
  setEcActionExecutionStatus: mocks.setActionStatus,
  upsertEcEventReadModels: mocks.upsertReadModels,
}));
vi.mock('@line-crm/line-sdk', () => ({ LineClient: mocks.lineClient }));
vi.mock('../services/event-bus.js', () => ({ fireEvent: vi.fn(), logOutgoingMessage: vi.fn() }));
vi.mock('../services/operator-notification-dispatch.js', () => ({ dispatchOperatorEvent: mocks.dispatchOperatorEvent }));
vi.mock('../services/nen-tag-sync.js', () => ({ syncNenEcTags: vi.fn(), syncNenPetTags: vi.fn() }));
vi.mock('../services/nen-engagement.js', () => ({ enqueuePostShippingFollowUps: vi.fn() }));

const { ecIntegrations } = await import('./ec-integrations.js');

const SECRET = 'b'.repeat(32);

async function hmac(value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** activeAccountIds：動いているアカウント。friendAccountIds：出来事の line_user_id が友だちとして登録されているアカウント。 */
function harness(activeAccountIds: string[], friendAccountIds: string[] = []) {
  const app = new Hono<any>();
  app.route('/', ecIntegrations);
  const db = {
    prepare(query: string) {
      const statement = {
        bind() { return statement; },
        async run() { return { success: true, meta: { changes: 1 } }; },
        async first() { return null; },
        async all() {
          if (query.includes('FROM friends f JOIN line_accounts a')) return { results: friendAccountIds.map((id) => ({ id })) };
          if (query.includes('FROM line_accounts') && !query.includes('JOIN')) return { results: activeAccountIds.slice(0, 2).map((id) => ({ id })) };
          return { results: [] };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { app, db };
}

const event = {
  event_id: 'eccube:order:501:confirmed:v1', event_type: 'ec.order.confirmed',
  occurred_at: '2026-09-17T01:00:00+09:00', customer_id: 501,
  line_user_id: 'U' + 'a'.repeat(32),
};

/** EC-CUBE 側と同じ形：ヘッダー無し、署名は `timestamp.body`。 */
async function legacyRequest(app: Hono<any>, db: D1Database, extraHeaders: Record<string, string> = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(event);
  return app.request('/api/integrations/eccube/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nen-timestamp': timestamp,
      'x-nen-signature': `sha256=${await hmac(`${timestamp}.${body}`)}`,
      ...extraHeaders,
    },
    body,
  }, { DB: db, ECCUBE_WEBHOOK_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'default-token' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAccount.mockResolvedValue({ id: 'account-only', is_active: 1, channel_access_token: 'token' });
  mocks.getFriend.mockResolvedValue(null);
});

describe('EC-CUBE イベント：X-Line-Account-Id が無いとき', () => {
  it('動いているアカウントが 1 つなら、そのアカウント宛てとして旧形式の署名で受け付ける', async () => {
    const { app, db } = harness(['account-only']);
    const response = await legacyRequest(app, db);
    expect(response.status).not.toBe(400);
    expect(response.status).not.toBe(401);
    expect(mocks.getAccount).toHaveBeenCalledWith(db, 'account-only');
  });

  it('旧形式でも署名が違えば 401', async () => {
    const { app, db } = harness(['account-only']);
    const response = await legacyRequest(app, db, { 'x-nen-signature': `sha256=${'0'.repeat(64)}` });
    expect(response.status).toBe(401);
    expect(mocks.getAccount).not.toHaveBeenCalled();
  });

  it('アカウントが 2 つ以上でも、line_user_id がどれか 1 つの友だちなら、そのアカウント宛て', async () => {
    mocks.getAccount.mockResolvedValue({ id: 'account-b', is_active: 1, channel_access_token: 'token' });
    const { app, db } = harness(['account-a', 'account-b', 'account-c'], ['account-b']);
    const response = await legacyRequest(app, db);
    expect(response.status).not.toBe(400);
    expect(response.status).not.toBe(401);
    expect(mocks.getAccount).toHaveBeenCalledWith(db, 'account-b');
  });

  it('アカウントが 2 つ以上で、友だちからも決められなければ 400（宛先が決められない）', async () => {
    const { app, db } = harness(['account-a', 'account-b'], []);
    const response = await legacyRequest(app, db);
    expect(response.status).toBe(400);
    expect(mocks.getAccount).not.toHaveBeenCalled();

    const both = await legacyRequest(app, harness(['account-a', 'account-b'], ['account-a', 'account-b']).db);
    expect(both.status).toBe(400);
  });

  it('署名の材料（タイムスタンプ）も無い素の POST は 400', async () => {
    const { app, db } = harness(['account-only']);
    const response = await app.request('/api/integrations/eccube/events', { method: 'POST', body: JSON.stringify(event) }, { DB: db, ECCUBE_WEBHOOK_SECRET: SECRET });
    expect(response.status).toBe(400);
  });

  it('ヘッダーがあるときは、これまでどおりアカウントIDを含めた署名を要求する', async () => {
    const { app, db } = harness(['account-only']);
    const response = await legacyRequest(app, db, { 'x-line-account-id': 'account-only' });
    expect(response.status).toBe(401);
  });
});
