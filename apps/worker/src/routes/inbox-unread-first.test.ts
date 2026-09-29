import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { chats } from './chats.js';
import { supportInbox } from './support-inbox.js';

// 受信箱の並びは「未読が先 → 最新の受信・送信が新しい順」。
// 未読は赤い点と同じ定義 (担当者の既読位置より新しい受信がある) で、
// 対応状況 (status) とは別。新しい既読より古い未読が上に来ること、
// ページ送りの2ページ目でも崩れないことを、LINE とメール両方で守る。
const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

type Channel = 'line' | 'email';
let db: SqliteD1;
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  db = createTestD1();
  db.raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', '本店', 'token', 'secret')`).run();
});
afterEach(() => { db.raw.close(); vi.restoreAllMocks(); });

function app(actor = 'reader-a') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: actor, name: actor, role: 'owner', readOnly: false });
    await next();
  });
  app.route('/', chats);
  app.route('/', supportInbox);
  return app;
}

// 4件の固定盤面。対応状況はすべて対応済み (並びが status 由来でない証拠) にし、
// 未読・既読と時刻を交差させる。期待順は [u-new, u-old, r-new, r-old]。
// r-new は u-old より新しい既読で、「新しい順だけ」なら先頭に来てしまう。
function seedBoard(channel: Channel) {
  const rows = [
    { id: 'u-new', minutesAgo: 60, read: false },
    { id: 'u-old', minutesAgo: 180, read: false },
    { id: 'r-new', minutesAgo: 30, read: true },
    { id: 'r-old', minutesAgo: 120, read: true },
  ];
  for (const row of rows) {
    const timestamp = at(row.minutesAgo);
    if (channel === 'line') {
      db.raw.prepare('INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES (?,?,?,?)')
        .run(row.id, row.id, row.id, 'account-a');
      db.raw.prepare(`INSERT INTO chats(id,friend_id,operator_id,status,last_message_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?)`).run(row.id, row.id, null, 'resolved', timestamp, timestamp, timestamp);
      db.raw.prepare(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at)
        VALUES (?,?,'incoming','text',?,?)`).run(row.id, row.id, row.id, timestamp);
    } else {
      db.raw.prepare(`INSERT INTO support_email_threads
        (id,customer_email,customer_name,subject,normalized_subject,status,assigned_staff_id,last_message_at,last_incoming_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(row.id, `${row.id}@example.test`, row.id, row.id, row.id, 'resolved', null,
          timestamp, timestamp, timestamp, timestamp);
    }
    if (row.read) {
      db.raw.prepare(`INSERT INTO inbox_staff_reads
        (staff_id,channel,conversation_id,last_read_at,updated_at) VALUES ('reader-a',?,?,?,?)`)
        .run(channel, row.id, new Date(NOW).toISOString(), new Date(NOW).toISOString());
    }
  }
}

async function lineRows(filters: Record<string, string> = {}) {
  const query = new URLSearchParams({ lineAccountId: 'account-a', limit: '200', ...filters });
  const res = await app().request(`/api/chats?${query}`, {}, { DB: db.db });
  expect(res.status).toBe(200);
  const body = await res.json() as { data: Array<{ id: string; isUnread: boolean; lastMessageAt: string }> };
  return body.data;
}

async function emailRows(filters: Record<string, string> = {}) {
  const query = new URLSearchParams({ channel: 'email', status: 'all', limit: '200', ...filters });
  const res = await app().request(`/api/support/inbox?${query}`, {}, { DB: db.db });
  expect(res.status).toBe(200);
  const body = await res.json() as { data: { items: Array<{ id: string; isUnread: boolean }> } };
  return body.data.items;
}

const bareId = (id: string) => id.replace(/^email:/, '');

describe.each(['line', 'email'] as const)('%s は未読が先・同じ中では新しい順', (channel) => {
  test('新しい既読より古い未読が上に来る', async () => {
    seedBoard(channel);
    const rows = channel === 'line' ? await lineRows() : await emailRows();
    expect(rows.map((row) => bareId(row.id))).toEqual(['u-new', 'u-old', 'r-new', 'r-old']);
  });

  test('ページ送りの2ページ目でも順番が崩れず欠落重複がない', async () => {
    seedBoard(channel);
    const found: string[] = [];
    if (channel === 'line') {
      // 未読2件・既読2件をまたぐ歩き方 (2件ずつ) と、境界をまたぐ歩き方 (3件ずつ) の両方。
      for (const pageSize of [2, 3]) {
        const walked: string[] = [];
        let cursor: Record<string, string> = { limit: String(pageSize) };
        for (let page = 0; page < 3; page++) {
          const rows = await lineRows(cursor);
          expect(rows.length).toBeLessThanOrEqual(pageSize);
          walked.push(...rows.map((row) => row.id));
          if (rows.length < pageSize) break;
          const last = rows[rows.length - 1];
          cursor = {
            limit: String(pageSize),
            beforeUnread: last.isUnread ? '1' : '0',
            beforeAt: last.lastMessageAt,
            beforeId: last.id,
          };
        }
        expect(walked).toEqual(['u-new', 'u-old', 'r-new', 'r-old']);
        found.push(...walked);
      }
    } else {
      let walked: string[] = [];
      for (let offset = 0; offset < 4; offset += 2) {
        const rows = await emailRows({ limit: '2', offset: String(offset) });
        walked.push(...rows.map((row) => bareId(row.id)));
      }
      expect(walked).toEqual(['u-new', 'u-old', 'r-new', 'r-old']);
      found.push(...walked);
    }
    expect(found.length).toBeGreaterThan(0);
  });
});

describe('line の古いカーソル (beforeUnread なし) は時刻条件のまま動く', () => {
  test('未読だけの絞り込みでは従来どおり歩ける', async () => {
    seedBoard('line');
    const first = await lineRows({ unreadOnly: '1', limit: '1' });
    expect(first.map((row) => row.id)).toEqual(['u-new']);
    const second = await lineRows({
      unreadOnly: '1', limit: '1', beforeAt: first[0].lastMessageAt, beforeId: first[0].id,
    });
    expect(second.map((row) => row.id)).toEqual(['u-old']);
  });
});
