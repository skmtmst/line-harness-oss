import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import { MAX_LIST_LIMIT } from '@line-crm/db';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';

/*
 * #722: 「直したはずの所に残っていた半分」を実 D1（bootstrap.sql）と実ルートで固定する。
 *
 * ここを手書きのDBモックでやると意味が無い。見張りたいのは
 *   - **SQL の `LIMIT` に何が渡るか**（名乗りと実際がずれていた）
 *   - **行が本当に増えるか／metadata が本当に書き換わるか**（記録の副作用）
 * で、どちらもモックだと自分で書いた答えを読み返すだけになる。
 */

const liff = vi.hoisted(() => ({ verify: vi.fn(async () => null as unknown) }));
vi.mock('../services/liff-auth.js', () => ({ verifyCallerLineIdentity: liff.verify }));
vi.mock('../services/account-access.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  canAccessAllLineAccounts: async () => true,
}));

const { forms } = await import('./forms.js');

function app(db: D1Database) {
  const harness = new Hono<any>();
  harness.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当者', role: 'owner', readOnly: false, permissionKeys: [] });
    c.env = { DB: db };
    await next();
  });
  harness.route('/', forms);
  return harness;
}

const LAYOUT = {
  version: 2,
  header: [],
  sections: [{
    id: 'section-1',
    name: '質問',
    blocks: [{ id: 'block-1', kind: 'input', type: 'text', name: 'q1', label: '名前', required: false }],
  }],
  options: {},
};

function seed(raw: Database, options: { isActive: number }) {
  raw.exec(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
            VALUES ('acc-a','ch-a','A店','token','secret')`);
  insertFriend(raw, 'friend-a', { line_account_id: 'acc-a' });
  raw.prepare(
    `INSERT INTO forms (id, name, fields, layout, is_active, status, created_at, updated_at)
     VALUES ('form-1', 'アンケート', '[]', ?, ?, 'active', '2026-01-01', '2026-01-01')`,
  // いったん公開してから停止する。公開版の無い純粋な下書きとは区別する。
  ).run(JSON.stringify(LAYOUT), 1);
  raw.prepare(`INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-1','acc-a')`).run();
  if (options.isActive === 0) {
    raw.prepare(`UPDATE forms SET is_active = 0 WHERE id = 'form-1'`).run();
  }
}

function insertSubmissions(raw: Database, count: number) {
  const statement = raw.prepare(
    `INSERT INTO form_submissions (id, form_id, friend_id, data, created_at)
     VALUES (?, 'form-1', 'friend-a', '{}', ?)`,
  );
  raw.exec('BEGIN');
  for (let index = 0; index < count; index += 1) {
    const minute = String(Math.floor(index / 60)).padStart(2, '0');
    const second = String(index % 60).padStart(2, '0');
    statement.run(`sub-${String(index).padStart(4, '0')}`, `2026-01-01T00:${minute}:${second}.000Z`);
  }
  raw.exec('COMMIT');
}

const openRows = (raw: Database) =>
  (raw.prepare('SELECT COUNT(*) AS count FROM form_opens').get() as { count: number }).count;
const metadataOf = (raw: Database) =>
  (raw.prepare(`SELECT metadata FROM friends WHERE id = 'friend-a'`).get() as { metadata: string | null }).metadata;

describe('#722 N1 ページ分けなしの回答一覧は、名乗った数だけ返す', () => {
  it('300件あっても200件で切り、Warning も同じ200と言う', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { isActive: 1 });
    insertSubmissions(raw, 300);

    const response = await app(db).fetch(
      new Request('https://worker.test/api/forms/form-1/submissions?account_id=acc-a'),
    );
    const body = await response.json() as { data: unknown[] };

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(200);
    // 名乗りと実際が一致していること。**ここがずれていたのが #722 N1。**
    const warning = response.headers.get('Warning');
    expect(warning).toBe('299 - "non-paginated submissions are limited to 200 rows; use page/limit"');
    expect(warning).toContain(String(body.data.length));
    /*
     * 口が名乗る数と、DB ヘルパの天井（`MAX_LIST_LIMIT`）が離れていないこと。
     * 離れると `boundedListLimit` が黙って切り直し、名乗りだけが大きくなる
     * ——#722 とまったく同じ形に戻る。
     */
    expect(body.data).toHaveLength(MAX_LIST_LIMIT);
  });

  it('上限より少なければ、そのまま全部返す', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { isActive: 1 });
    insertSubmissions(raw, 5);

    const response = await app(db).fetch(
      new Request('https://worker.test/api/forms/form-1/submissions?account_id=acc-a'),
    );
    const body = await response.json() as { data: unknown[] };
    expect(body.data).toHaveLength(5);
  });

  it('page/limit を付ければ、201件目以降にも届く', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { isActive: 1 });
    insertSubmissions(raw, 300);

    const response = await app(db).fetch(
      new Request('https://worker.test/api/forms/form-1/submissions?account_id=acc-a&page=2&limit=200'),
    );
    const body = await response.json() as { data: { items: unknown[]; total: number; limit: number } };
    expect(body.data.items).toHaveLength(100);
    expect(body.data.total).toBe(300);
    expect(body.data.limit).toBe(200);
    // ページ送りで呼んだときは、切っていないので Warning を出さない。
    expect(response.headers.get('Warning')).toBeNull();
  });
});

describe('#722 N2 受付を止めたフォームは、記録も下書きも増やさない', () => {
  it('is_active=0 の /opened は form_opens を増やさない', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { isActive: 0 });

    const response = await app(db).fetch(
      new Request('https://worker.test/api/forms/form-1/opened', { method: 'POST' }),
    );

    expect(response.status).toBe(200);   // 計測口なので呼び出し元は邪魔しない
    expect(openRows(raw)).toBe(0);       // それでも記録は増やさない
  });

  it('受付中の /opened は、いままでどおり記録する', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { isActive: 1 });

    const response = await app(db).fetch(
      new Request('https://worker.test/api/forms/form-1/opened', { method: 'POST' }),
    );

    expect(response.status).toBe(200);
    expect(openRows(raw)).toBe(1);
  });

  it('保管したフォームの /opened は 404 で、記録もしない', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { isActive: 1 });
    raw.prepare(`UPDATE forms SET status = 'archived' WHERE id = 'form-1'`).run();

    const response = await app(db).fetch(
      new Request('https://worker.test/api/forms/form-1/opened', { method: 'POST' }),
    );

    expect(response.status).toBe(404);
    expect(openRows(raw)).toBe(0);
  });

  it('is_active=0 の /partial は断り、friends.metadata を書き換えない', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { isActive: 0 });
    liff.verify.mockResolvedValue({ lineUserId: 'Ufriend-a', lineAccountId: 'acc-a' });

    const response = await app(db).fetch(new Request('https://worker.test/api/forms/form-1/partial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ data: { q1: '書けてしまう' } }),
    }));

    expect(response.status).toBe(400);
    expect(metadataOf(raw)).not.toContain('書けてしまう');
  });

  it('受付中の /partial は、いままでどおり下書きを保存する', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { isActive: 1 });
    liff.verify.mockResolvedValue({ lineUserId: 'Ufriend-a', lineAccountId: 'acc-a' });

    const response = await app(db).fetch(new Request('https://worker.test/api/forms/form-1/partial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ data: { q1: '保存される' } }),
    }));

    expect(response.status).toBe(200);
    expect(metadataOf(raw)).toContain('保存される');
  });
});
