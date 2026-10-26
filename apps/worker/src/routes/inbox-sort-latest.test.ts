import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { _resetVisibleLineAccountScopeCacheForTest } from '../services/account-access.js';
import { chats } from './chats.js';

// 受信箱の「新しい順」(sort=latest)。未読を先にせず、最新の受信・送信が新しい順だけで並べる。
// 既定 (未読が先) は変えない。見えるアカウントの範囲は既定と同じ条件で絞る。
const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

let db: SqliteD1;
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  _resetVisibleLineAccountScopeCacheForTest();
  db = createTestD1();
  db.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-x', '別の統括')`).run();
  db.raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES ('account-a', 'channel-a', '本店', 'token', 'secret', NULL),
           ('account-b', 'channel-b', '支店', 'token', 'secret', NULL),
           ('account-x', 'channel-x', '別統括の店', 'token', 'secret', 'tenant-x')`).run();
  db.raw.prepare(`INSERT INTO staff_members (id, name, role, api_key, account_scope)
    VALUES ('reader-a', 'reader-a', 'owner', 'key-a', 'all'),
           ('reader-b', 'reader-b', 'owner', 'key-b', 'all'),
           ('scoped-a', 'scoped-a', 'staff', 'key-s', 'accounts')`).run();
  db.raw.prepare(`INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at) VALUES ('scoped-a', 'account-a', '2026-09-13T00:00:00.000Z')`).run();
});
afterEach(() => { db.raw.close(); vi.restoreAllMocks(); });

function app(actor: string, role: 'owner' | 'staff' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: actor, name: actor, role, readOnly: false });
    await next();
  });
  app.route('/', chats);
  return app;
}

function seedFriend(id: string, account: string, minutesAgo: number) {
  const timestamp = at(minutesAgo);
  db.raw.prepare('INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES (?,?,?,?)')
    .run(id, id, id, account);
  db.raw.prepare(`INSERT INTO chats(id,friend_id,operator_id,status,last_message_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run(id, id, null, 'resolved', timestamp, timestamp, timestamp);
  db.raw.prepare(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at)
    VALUES (?,?,'incoming','text',?,?)`).run(id, id, id, timestamp);
}

function markRead(staffId: string, id: string) {
  const timestamp = new Date(NOW).toISOString();
  db.raw.prepare(`INSERT INTO inbox_staff_reads
    (staff_id,channel,conversation_id,last_read_at,updated_at) VALUES (?, 'line', ?, ?, ?)`)
    .run(staffId, id, timestamp, timestamp);
}

// 未読と既読を時刻で交差させる。新しい順は [r-new, u-new, r-old, u-old]、
// 未読が先なら [u-new, u-old, r-new, r-old]。
function seedBoard() {
  seedFriend('u-new', 'account-a', 60);
  seedFriend('u-old', 'account-a', 180);
  seedFriend('r-new', 'account-a', 30);
  seedFriend('r-old', 'account-a', 120);
  markRead('reader-a', 'r-new');
  markRead('reader-a', 'r-old');
}

type Row = { id: string; isUnread: boolean; lastMessageAt: string };

async function request(actor: string, filters: Record<string, string>, role: 'owner' | 'staff' = 'owner') {
  return app(actor, role).request(`/api/chats?${new URLSearchParams(filters)}`, {}, { DB: db.db });
}

async function rows(actor: string, filters: Record<string, string>, role: 'owner' | 'staff' = 'owner') {
  const res = await request(actor, filters, role);
  expect(res.status).toBe(200);
  return (await res.json() as { data: Row[] }).data;
}

describe('GET /api/chats?sort=latest', () => {
  test('未読を先にせず新しい順で並ぶ（古い未読が新しい既読より上に来ない）', async () => {
    seedBoard();
    const list = await rows('reader-a', { lineAccountId: 'account-a', sort: 'latest' });
    expect(list.map((row) => row.id)).toEqual(['r-new', 'u-new', 'r-old', 'u-old']);
    expect(list.map((row) => row.isUnread)).toEqual([false, true, false, true]);
  });

  test('既定と sort=unread_first は今までどおり未読が先', async () => {
    seedBoard();
    const expected = ['u-new', 'u-old', 'r-new', 'r-old'];
    expect((await rows('reader-a', { lineAccountId: 'account-a' })).map((row) => row.id)).toEqual(expected);
    expect((await rows('reader-a', { lineAccountId: 'account-a', sort: 'unread_first' })).map((row) => row.id))
      .toEqual(expected);
  });

  test('さらに読み込むで重なり・抜けが無い（未読の印をカーソルに混ぜても新しい順のまま）', async () => {
    seedBoard();
    for (const pageSize of [1, 2, 3]) {
      const walked: string[] = [];
      let cursor: Record<string, string> = {};
      for (let page = 0; page < 5; page++) {
        const list = await rows('reader-a', {
          lineAccountId: 'account-a', sort: 'latest', limit: String(pageSize), ...cursor,
        });
        walked.push(...list.map((row) => row.id));
        if (list.length < pageSize) break;
        const last = list[list.length - 1];
        // 画面が未読の印を付けたまま渡しても、新しい順の歩き方は崩れない。
        cursor = { beforeUnread: last.isUnread ? '1' : '0', beforeAt: last.lastMessageAt, beforeId: last.id };
      }
      expect(walked).toEqual(['r-new', 'u-new', 'r-old', 'u-old']);
    }
  });

  test('同じ時刻の会話は友だち ID の降順で切れ目なく歩ける', async () => {
    for (const id of ['same-1', 'same-2', 'same-3']) seedFriend(id, 'account-a', 10);
    markRead('reader-a', 'same-2');
    const walked: string[] = [];
    let cursor: Record<string, string> = {};
    for (let page = 0; page < 4; page++) {
      const list = await rows('reader-a', { lineAccountId: 'account-a', sort: 'latest', limit: '1', ...cursor });
      if (list.length === 0) break;
      walked.push(list[0].id);
      cursor = { beforeAt: list[0].lastMessageAt, beforeId: list[0].id };
    }
    expect(walked).toEqual(['same-3', 'same-2', 'same-1']);
  });

  test('知らない並びの値は 400 で断る', async () => {
    seedBoard();
    const res = await request('reader-a', { lineAccountId: 'account-a', sort: 'oldest' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'invalid_sort' });
  });

  test('既読は担当者ごと：A さんの既読は B さんの未読を消さない', async () => {
    seedBoard();
    const forB = await rows('reader-b', { lineAccountId: 'account-a', sort: 'latest' });
    expect(forB.map((row) => row.id)).toEqual(['r-new', 'u-new', 'r-old', 'u-old']);
    expect(forB.every((row) => row.isUnread)).toBe(true);
  });

  test('見えないアカウントの会話は新しい順でも出さない', async () => {
    seedFriend('in-a', 'account-a', 50);
    seedFriend('in-b', 'account-b', 20);
    seedFriend('in-x', 'account-x', 5);
    // 担当範囲が account-a だけの人は、アカウント指定なしでも account-a の会話だけ。
    const scoped = await rows('scoped-a', { sort: 'latest' }, 'staff');
    expect(scoped.map((row) => row.id)).toEqual(['in-a']);
    // 範囲外のアカウントを名指ししても中身を返さない。
    const denied = await request('scoped-a', { sort: 'latest', lineAccountId: 'account-b' }, 'staff');
    expect(denied.status).toBe(404);
    // 統括の外の店は、全アカウントを見られる人にも出さない。
    const owner = await rows('reader-a', { sort: 'latest' });
    expect(owner.map((row) => row.id)).toEqual(['in-b', 'in-a']);
    const otherTenant = await request('reader-a', { sort: 'latest', lineAccountId: 'account-x' });
    expect(otherTenant.status).toBe(404);
  });
});
