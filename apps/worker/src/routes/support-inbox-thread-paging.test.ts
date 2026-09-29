import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { supportInbox } from './support-inbox.js';

/*
 * PERF-11: メール会話は初回に新しい側から区切って返し、before= で
 * 古い履歴、after= で新着の差分を取る。取りこぼし・重複・順序逆転が
 * ないことを実SQLiteで確かめる。
 */
let db: SqliteD1;

beforeEach(() => {
  db = createTestD1();
  db.raw.prepare(`INSERT INTO support_email_threads
    (id, customer_email, customer_name, subject, normalized_subject, status, last_message_at, last_incoming_at, created_at, updated_at)
    VALUES ('t1', 'customer@example.test', '顧客', '件名', '件名', 'unread', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
    .run();
});

afterEach(() => {
  db.raw.close();
});

function app() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'reader-a', name: 'reader-a', role: 'owner', readOnly: false });
    await next();
  });
  app.route('/', supportInbox);
  return app;
}

function seedMessages(count: number) {
  const insert = db.raw.prepare(`INSERT INTO support_email_messages
    (id, thread_id, direction, sender_email, recipient_email, subject, body_text, created_at)
    VALUES (?, 't1', 'incoming', 'customer@example.test', 'support@example.test', '件名', ?, ?)`);
  for (let i = 0; i < count; i++) {
    // 同時刻も混ぜて、created_at だけでは順を切れない状態にする。
    const at = new Date(Date.parse('2026-01-01T00:00:00Z') + Math.floor(i / 2) * 1000).toISOString();
    insert.run(`m-${String(i).padStart(4, '0')}`, `本文${i}`, at);
  }
}

async function get(query = '') {
  const res = await app().request(`/api/support/email/threads/t1${query}`, {}, { DB: db.db });
  return res;
}

type Body = {
  success: boolean;
  data: {
    messages: Array<{ id: string; created_at: string }>;
    total: number;
    hasMoreOlder: boolean;
    oldestCursor: string | null;
    newestCursor: string | null;
  };
};

describe('PERF-11 メール会話の区切り取得', () => {
  it('初回は新しい側から100件で、古い履歴があることを伝える', async () => {
    seedMessages(150);
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.data.messages).toHaveLength(100);
    expect(body.data.total).toBe(150);
    expect(body.data.hasMoreOlder).toBe(true);
    // 新しい側100件 = 末尾100件が昇順で届く。
    const ids = body.data.messages.map((m) => m.id);
    expect(ids[0]).toBe('m-0050');
    expect(ids[ids.length - 1]).toBe('m-0149');
  });

  it('before= で古い履歴を重複なく遡り、最古で旗が降りる', async () => {
    seedMessages(150);
    const first = ((await (await get()).json()) as Body).data;
    const res = await get(`?before=${encodeURIComponent(first.oldestCursor!)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.data.messages).toHaveLength(50);
    expect(body.data.hasMoreOlder).toBe(false);
    // 先頭50件が届き、初回分と重ならない。
    const ids = body.data.messages.map((m) => m.id);
    expect(ids[0]).toBe('m-0000');
    expect(ids[ids.length - 1]).toBe('m-0049');
    const overlap = ids.filter((id) => first.messages.some((m) => m.id === id));
    expect(overlap).toEqual([]);
  });

  it('after= はカーソルより新しい差分だけを昇順で返す', async () => {
    seedMessages(120);
    const first = ((await (await get()).json()) as Body).data;
    // 新着2件を足す。
    db.raw.prepare(`INSERT INTO support_email_messages
      (id, thread_id, direction, sender_email, recipient_email, subject, body_text, created_at)
      VALUES ('m-9998', 't1', 'incoming', 'c@x', 's@x', '件名', '新着1', '2026-02-01T00:00:00Z')`).run();
    db.raw.prepare(`INSERT INTO support_email_messages
      (id, thread_id, direction, sender_email, recipient_email, subject, body_text, created_at)
      VALUES ('m-9999', 't1', 'incoming', 'c@x', 's@x', '件名', '新着2', '2026-02-01T00:01:00Z')`).run();
    const res = await get(`?after=${encodeURIComponent(first.newestCursor!)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.data.messages.map((m) => m.id)).toEqual(['m-9998', 'm-9999']);
    // 新着差分でも古い側の有無は分かる（画面は持っている旗と併用する）。
    expect(body.data.hasMoreOlder).toBe(true);
  });

  it('after= で差分が無ければ空を返し、会話の状態は最新のまま', async () => {
    seedMessages(3);
    const first = ((await (await get()).json()) as Body).data;
    const res = await get(`?after=${encodeURIComponent(first.newestCursor!)}`);
    const body = (await res.json()) as Body;
    expect(body.data.messages).toEqual([]);
    expect(body.data.newestCursor).toBeNull();
    expect((body.data as unknown as { thread: { status: string } }).thread.status).toBe('unread');
  });

  it('変なカーソルと before/after の同時指定は 400 にする', async () => {
    seedMessages(3);
    for (const query of ['?before=not-a-cursor', '?after=~', '?before=a~b&after=c~d']) {
      const res = await get(query);
      expect(res.status).toBe(400);
    }
  });

  it('小さい会話は従来どおり全部返り、旗は降りている', async () => {
    seedMessages(5);
    const body = ((await (await get()).json()) as Body).data;
    expect(body.messages).toHaveLength(5);
    expect(body.total).toBe(5);
    expect(body.hasMoreOlder).toBe(false);
  });
});
