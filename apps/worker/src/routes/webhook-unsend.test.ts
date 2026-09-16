import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';

const lineClient = vi.hoisted(() => ({
  getProfile: vi.fn(),
  replyMessage: vi.fn(),
  replyMessageWithRequestId: vi.fn(),
  pushMessage: vi.fn(),
}));
const autoReply = vi.hoisted(() => vi.fn().mockResolvedValue({
  matched: false,
  replyTokenConsumed: false,
}));
const mileage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@line-crm/line-sdk', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/line-sdk')>('@line-crm/line-sdk');
  return {
    ...actual,
    verifySignature: vi.fn().mockResolvedValue(true),
    LineClient: vi.fn().mockImplementation(() => lineClient),
  };
});
vi.mock('../services/auto-reply.js', () => ({ matchAndReply: autoReply }));
vi.mock('../services/activity-mileage.js', () => ({ awardActivityMileage: mileage }));
vi.mock('../services/event-bus.js', () => ({
  fireEvent: vi.fn().mockResolvedValue(undefined),
  logOutgoingMessage: vi.fn().mockResolvedValue(undefined),
}));

const { webhook } = await import('./webhook.js');
const { chats } = await import('./chats.js');

const owner: AuthenticatedStaff = {
  id: 'owner-1',
  name: 'オーナー',
  role: 'owner',
  readOnly: false,
  tenantId: 'tenant-1',
};

function seed(db: SqliteD1): void {
  db.raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')").run();
  db.raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES
      ('account-a', 'channel-a', '店舗A', 'token-a', 'secret-a', 1, 'tenant-1'),
      ('account-b', 'channel-b', '店舗B', 'token-b', 'secret-b', 1, 'tenant-1')
  `).run();
  insertFriend(db.raw, 'friend-a', { line_user_id: 'U-a', line_account_id: 'account-a' });
  insertFriend(db.raw, 'friend-b', { line_user_id: 'U-b', line_account_id: 'account-b' });
}

function webhookApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.route('/', webhook);
  return app;
}

function chatsApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', owner);
    await next();
  });
  app.route('/', chats);
  return app;
}

async function postEvent(
  db: SqliteD1,
  account: 'a' | 'b',
  event: Record<string, unknown>,
): Promise<void> {
  const waitUntil = vi.fn();
  const response = await webhookApp().request('/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Line-Signature': 'x'.repeat(44) },
    body: JSON.stringify({ destination: `destination-${account}`, events: [event] }),
  }, {
    DB: db.db,
    LINE_CHANNEL_SECRET: `secret-${account}`,
    LINE_CHANNEL_ACCESS_TOKEN: `token-${account}`,
  } as Env['Bindings'], {
    waitUntil,
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext);
  expect(response.status).toBe(200);
  await expect(waitUntil.mock.calls[0]?.[0] as Promise<void>).resolves.toBeUndefined();
}

const base = (account: 'a' | 'b', eventId: string, timestamp: number) => ({
  timestamp,
  source: { type: 'user', userId: `U-${account}` },
  webhookEventId: eventId,
  deliveryContext: { isRedelivery: false },
  mode: 'active',
});

async function postText(
  db: SqliteD1,
  account: 'a' | 'b',
  eventId: string,
  messageId: string,
  text: string,
  timestamp: number,
): Promise<void> {
  await postEvent(db, account, {
    ...base(account, eventId, timestamp),
    type: 'message',
    replyToken: `reply-${eventId}`,
    message: { type: 'text', id: messageId, text },
  });
}

async function postUnsend(
  db: SqliteD1,
  account: 'a' | 'b',
  eventId: string,
  messageId: string,
  timestamp: number,
): Promise<void> {
  await postEvent(db, account, {
    ...base(account, eventId, timestamp),
    type: 'unsend',
    unsend: { messageId },
  });
}

describe('N-024 LINE送信取消', () => {
  let db: SqliteD1;

  beforeEach(() => {
    db = createTestD1();
    seed(db);
    autoReply.mockClear();
    mileage.mockClear();
  });

  afterEach(() => {
    db.raw.close();
    vi.clearAllMocks();
  });

  it('既存messageを取消し、重複unsendと別account同一message IDを分離してAPIを伏せる', async () => {
    await postText(db, 'a', 'event-message-a', 'line-message-shared', 'Aだけの秘密本文', 1_800_000_000_000);
    await postText(db, 'b', 'event-message-b', 'line-message-shared', 'Bの通常本文', 1_800_000_000_100);

    await postUnsend(db, 'a', 'event-unsend-a-1', 'line-message-shared', 1_800_000_000_200);
    await postUnsend(db, 'a', 'event-unsend-a-2', 'line-message-shared', 1_800_000_000_300);

    expect(db.raw.prepare(`
      SELECT line_account_id, content, unsent_at IS NOT NULL AS is_unsent
        FROM messages_log
       WHERE line_message_id = 'line-message-shared'
       ORDER BY line_account_id
    `).all()).toEqual([
      { line_account_id: 'account-a', content: '', is_unsent: 1 },
      { line_account_id: 'account-b', content: 'Bの通常本文', is_unsent: 0 },
    ]);
    expect(db.raw.prepare(`
      SELECT COUNT(*) AS count FROM line_message_unsends
       WHERE line_message_account_key = 'account-a' AND line_message_id = 'line-message-shared'
    `).get()).toEqual({ count: 1 });

    const env = { DB: db.db } as Env['Bindings'];
    const cancelled = await chatsApp().request('/api/chats/friend-a', {}, env);
    expect(cancelled.status).toBe(200);
    const cancelledBody = await cancelled.json() as { data: { messages: Array<Record<string, unknown>> } };
    expect(cancelledBody.data.messages).toHaveLength(1);
    expect(cancelledBody.data.messages[0]).toMatchObject({
      messageType: 'text',
      content: '',
      isUnsent: true,
    });
    expect(JSON.stringify(cancelledBody)).not.toContain('Aだけの秘密本文');

    const list = await chatsApp().request('/api/chats?lineAccountId=account-a', {}, env);
    const listText = await list.text();
    expect(list.status).toBe(200);
    expect(listText).toContain('"lastMessageType":"unsent"');
    expect(listText).not.toContain('Aだけの秘密本文');

    const other = await chatsApp().request('/api/chats/friend-b', {}, env);
    const otherBody = await other.json() as { data: { messages: Array<Record<string, unknown>> } };
    expect(otherBody.data.messages[0]).toMatchObject({
      content: 'Bの通常本文',
      isUnsent: false,
    });
  });

  it('unsendが先着しても後着messageの本文・添付を復活させず副作用を起こさない', async () => {
    await postUnsend(db, 'a', 'event-unsend-first', 'line-message-late', 1_800_000_001_000);
    autoReply.mockClear();
    mileage.mockClear();

    await postText(
      db,
      'a',
      'event-message-late',
      'line-message-late',
      '後から届いたが表示してはいけない本文 https://attachment.example/secret',
      1_800_000_000_000,
    );

    expect(db.raw.prepare(`
      SELECT content, unsent_at IS NOT NULL AS is_unsent
        FROM messages_log
       WHERE line_message_account_key = 'account-a' AND line_message_id = 'line-message-late'
    `).get()).toEqual({ content: '', is_unsent: 1 });
    expect(autoReply).not.toHaveBeenCalled();
    expect(mileage).not.toHaveBeenCalled();

    const response = await chatsApp().request(
      '/api/chats/friend-a',
      {},
      { DB: db.db } as Env['Bindings'],
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain('"isUnsent":true');
    expect(text).not.toContain('後から届いた');
    expect(text).not.toContain('attachment.example');
  });
});
