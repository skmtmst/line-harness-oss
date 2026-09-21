import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { chats } from './chats.js';

/*
 * INBOX-09: 「すべて／要返信／1時間以上待ち」の件数を、一覧と同じ
 * 条件（アカウント・検索・担当・未読・経路）でサーバーが数える口。
 * 札に出る件数と、その札を押したときの一覧の対象が一致することを
 * 実SQLite・実ルートで確かめる。
 */

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
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
  return app;
}

function seedLine(id: string, options: {
  assignee?: string | null; age?: number; read?: boolean; status?: string; name?: string;
} = {}) {
  const at = new Date(NOW - (options.age ?? 30 * 60_000)).toISOString();
  const assignee = options.assignee === undefined ? 'target' : options.assignee;
  const status = options.status ?? 'unread';
  db.raw.prepare('INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES (?,?,?,?)')
    .run(id, id, options.name ?? id, 'account-a');
  db.raw.prepare(`INSERT INTO chats(id,friend_id,operator_id,status,last_message_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run(id, id, assignee, status, at, at, at);
  db.raw.prepare(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at)
    VALUES (?,?,'incoming','text',?,?)`).run(id, id, `msg-${id}`, at);
  if (options.read) db.raw.prepare(`INSERT INTO inbox_staff_reads
    (staff_id,channel,conversation_id,last_read_at,updated_at) VALUES ('reader-a','line',?,?,?)`)
    .run(id, new Date(NOW).toISOString(), new Date(NOW).toISOString());
}

function seedEmail(id: string, options: {
  assignee?: string | null; age?: number; status?: string; name?: string;
} = {}) {
  const at = new Date(NOW - (options.age ?? 30 * 60_000)).toISOString();
  const assignee = options.assignee === undefined ? 'target' : options.assignee;
  const status = options.status ?? 'unread';
  db.raw.prepare(`INSERT INTO support_email_threads
    (id,customer_email,customer_name,subject,normalized_subject,status,assigned_staff_id,last_message_at,last_incoming_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, `${id}@example.test`, options.name ?? id, id, id, status, assignee, at, at, at, at);
}

async function counts(filters: Record<string, string> = {}, actor = 'reader-a') {
  const query = new URLSearchParams({ channel: 'all', ...filters });
  const res = await app(actor).request(`/api/chats/quick-counts?${query}`, {}, { DB: db.db });
  return { status: res.status, body: await res.json() as { success: boolean; data?: { all: number; reply: number; overdue: number; line: { all: number }; email: { all: number } } } };
}

describe('GET /api/chats/quick-counts (INBOX-09)', () => {
  test('LINEとメールを合算し、要返信・1時間以上待ちは未対応だけを数える', async () => {
    seedLine('line-unread-recent', { age: 10 * 60_000 });
    seedLine('line-unread-old', { age: 2 * 3600_000 });
    seedLine('line-resolved-old', { status: 'resolved', age: 3 * 3600_000 });
    seedEmail('mail-unread-old', { age: 2 * 3600_000 });
    seedEmail('mail-resolved', { status: 'resolved' });

    const { status, body } = await counts({ lineAccountId: 'account-a' });
    expect(status).toBe(200);
    // lineAccountId を渡すとメール一覧と同じくメールは対象外。
    expect(body.data).toMatchObject({ all: 3, reply: 2, overdue: 1 });

    const all = await counts();
    expect(all.body.data).toMatchObject({ all: 5, reply: 3, overdue: 2 });
    expect(all.body.data?.line.all).toBe(3);
    expect(all.body.data?.email.all).toBe(2);
  });

  test('経路の絞り込みで片側だけを数える', async () => {
    seedLine('line-a');
    seedEmail('mail-a');
    expect((await counts({ channel: 'line' })).body.data?.all).toBe(1);
    expect((await counts({ channel: 'email' })).body.data?.all).toBe(1);
    expect((await counts({ channel: 'all' })).body.data?.all).toBe(2);
  });

  test('担当・検索・未読の条件を件数にも適用する', async () => {
    seedLine('hit', { assignee: 'target', name: '河野' });
    seedLine('other-assignee', { assignee: 'other' });
    seedLine('other-name', { assignee: 'target', name: '別人' });
    seedEmail('mail-hit', { assignee: 'target', name: '河野' });

    const byAssignee = await counts({ operatorId: 'target' });
    expect(byAssignee.body.data?.all).toBe(3);
    const byQuery = await counts({ q: '河野' });
    expect(byQuery.body.data?.all).toBe(2);
    const combined = await counts({ operatorId: 'target', q: '河野' });
    expect(combined.body.data).toMatchObject({ all: 2, reply: 2 });
  });

  test('1時間の境界は60分を含み59分59秒を含まない', async () => {
    seedLine('before', { age: 3599_000 });
    seedLine('boundary', { age: 3600_000 });
    const { body } = await counts();
    expect(body.data).toMatchObject({ all: 2, reply: 2, overdue: 1 });
  });

  test('チャネル値が不正なら400、権限外アカウントなら404', async () => {
    expect((await counts({ channel: 'bogus' })).status).toBe(400);
    expect((await counts({ lineAccountId: 'account-x' })).status).toBe(404);
  });
});
