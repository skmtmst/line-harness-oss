import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { recordIncomingLineMessage } from '@line-crm/db';
import { upsertChatOnMessage } from '@line-crm/db';
import { chats } from './chats.js';

/*
 * 受信の並びを LINE のイベント時刻順にする。
 *
 * 届く順と起こった順は逆転する（再送・遅延）。保存時刻（created_at）で
 * 並べると、後から届いた古いメッセージが一番上に来て、会話の流れが
 * 読めなくなる。LINE イベントの timestamp を保存し、一覧とスレッドの
 * 並びはそちらを正とする。
 */
let db: SqliteD1;
beforeEach(() => {
  db = createTestD1();
  db.raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', '本店', 'token', 'secret')`).run();
  for (const friend of ['friend-a', 'friend-b'] as const) {
    db.raw.prepare('INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES (?,?,?,?)')
      .run(friend, friend, friend, 'account-a');
  }
});
afterEach(() => { db.raw.close(); });

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', { id: 'reader-a', name: 'reader-a', role: 'owner', readOnly: false });
    await next();
  });
  instance.route('/', chats);
  return instance;
}

const T0 = '2026-09-20T10:00:00.000';
const T1 = '2026-09-20T10:05:00.000';
const T2 = '2026-09-20T10:10:00.000';

async function receive(friendId: string, lineMessageId: string, createdAt: string, lineEventAt: string) {
  await recordIncomingLineMessage(db.db, {
    id: `log-${lineMessageId}`,
    friendId,
    messageType: 'text',
    content: `本文-${lineMessageId}`,
    lineAccountId: 'account-a',
    lineMessageAccountKey: 'account-a',
    lineMessageId,
    createdAt,
    lineEventAt,
  });
  await upsertChatOnMessage(db.db, friendId, lineEventAt);
}

describe('受信の並びはLINEイベント時刻順', () => {
  it('後に届いた古いイベントは上に来ない（一覧）', async () => {
    // A: 10:10 に届いたが、起こったのは 10:00。B: 10:05 に起こり 10:05 に届いた。
    // 到着順（B→A）とイベント順（Bが新しい）が逆になるよう、Aを後に届かせる。
    await receive('friend-b', 'msg-b1', T1, T1);
    await receive('friend-a', 'msg-a1', T2, T0);
    const res = await app().request('/api/chats?lineAccountId=account-a&limit=200', {}, { DB: db.db });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string }> };
    const ids = body.data.map((item) => item.id);
    expect(ids.slice(0, 2)).toEqual(['friend-b', 'friend-a']);
  });

  it('スレッド内もイベント時刻順に並ぶ', async () => {
    await receive('friend-a', 'msg-a1', T2, T0);
    await receive('friend-a', 'msg-a2', T1, T1);
    const res = await app().request('/api/chats/friend-a', {}, { DB: db.db });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { messages: Array<{ id: string }> } };
    const ids = body.data.messages.map((message) => message.id);
    expect(ids).toEqual(['log-msg-a1', 'log-msg-a2']);
  });
});
