import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { upsertChatOnMessage } from '@line-crm/db';
import { chats } from './chats.js';

let db: SqliteD1;
beforeEach(async () => {
  db = createTestD1();
  db.raw.exec(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', '店舗', 'token', 'secret');`);
  for (const [id, metadata] of [['on', '{"__attention":"1"}'], ['off', '{}'], ['removed', '{"__attention":null}'], ['broken', 'not-json']]) {
    db.raw.prepare('INSERT INTO friends(id,line_user_id,display_name,line_account_id,metadata) VALUES (?,?,?,?,?)')
      .run(id, id, id, 'account-a', metadata);
    await upsertChatOnMessage(db.db, id, new Date().toISOString());
    db.raw.prepare("INSERT INTO messages_log(id,friend_id,direction,message_type,content,line_account_id) VALUES(?,?,'incoming','text','本文','account-a')").run(`msg-${id}`, id);
  }
});
afterEach(() => db.raw.close());

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', { id: 'reader', name: '担当', role: 'owner', readOnly: false });
    await next();
  });
  instance.route('/', chats);
  return instance;
}

describe('受信箱一覧の注目印', () => {
  it.each(['', '&sort=latest', '&unansweredOnly=true', '&sort=sla_due'])('友だちと同じ注目状態を返す（%s）', async (query) => {
    if (query.includes('sla_due')) {
      db.raw.exec("INSERT INTO inbox_routing_settings(account_id,sla_enabled,sla_first_response_minutes,sla_business_hours_only,updated_at) VALUES('account-a',1,30,0,datetime('now'))");
    }
    const response = await app().request(`/api/chats?lineAccountId=account-a${query}`, {}, { DB: db.db });
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { friendId: string; isAttention: boolean }[] };
    expect(Object.fromEntries(body.data.map(row => [row.friendId, row.isAttention]))).toEqual({ on: true, off: false, removed: false, broken: false });
  });
});
