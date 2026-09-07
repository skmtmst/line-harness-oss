import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';

import { chats } from './chats.js';

// #548-7（点検 #493 の7番）の再発防止の契約テスト。
// `GET /api/chats/:id` のメッセージは `direction` / `messageType` / `source` /
// `sentByStaffName` / `scenarioName` の形で返る。`senderType` は存在しない。
// 画面の型（`api.ts` の `ChatDetailMessage`）とここがずれると、向きの
// 分岐が誤表示になる。

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};

function chatsApp(db: D1Database, actor: AuthenticatedStaff = owner) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db, LINE_CHANNEL_ACCESS_TOKEN: 'default-token', WORKER_URL: 'https://worker.example' } as Env['Bindings'];
    c.set('staff', actor);
    await next();
  });
  instance.route('/', chats);
  return instance;
}

function seedTenantsAndAccounts(db: SqliteD1): void {
  db.raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')").run();
  db.raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1')
  `).run();
}

describe('#548-7 会話詳細のメッセージは実応答の形で返る', () => {
  let testDb: SqliteD1;
  beforeEach(() => {
    testDb = createTestD1();
    seedTenantsAndAccounts(testDb);
    insertFriend(testDb.raw, 'friend-shape', { line_account_id: 'account-1' });
    testDb.raw.prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, source, created_at)
       VALUES ('shape-in', 'friend-shape', 'incoming', 'text', 'こんにちは', 'user', '2026-09-08T10:00:00.000Z'),
              ('shape-out', 'friend-shape', 'outgoing', 'text', 'いらっしゃいませ', 'operator', '2026-09-08T10:01:00.000Z')`,
    ).run();
  });
  afterEach(() => {
    testDb.raw.close();
  });

  it('向き・種別・出どころ・職員名・シナリオ名を持ち、senderType は持たない', async () => {
    const response = await chatsApp(testDb.db).request('/api/chats/friend-shape', {}, {
      DB: testDb.db,
    } as Env['Bindings']);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { messages: Array<Record<string, unknown>> };
    };
    expect(body.data.messages).toHaveLength(2);
    expect(body.data.messages[0]).toMatchObject({
      id: 'shape-in',
      direction: 'incoming',
      messageType: 'text',
      content: 'こんにちは',
      source: 'user',
      sentByStaffName: null,
      scenarioName: null,
    });
    expect(body.data.messages[1]).toMatchObject({
      id: 'shape-out',
      direction: 'outgoing',
      source: 'operator',
    });
    for (const message of body.data.messages) {
      expect(message).not.toHaveProperty('senderType');
    }
  });
});
