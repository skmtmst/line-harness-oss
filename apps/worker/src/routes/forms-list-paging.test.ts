import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';

/*
 * #1060: `GET /api/forms?with_list_summary=1` のサーバーページング。
 * これまで画面が全件を受け取ってから絞り込み・並び替え・ページ切りをして
 * いた。`page`/`limit`/`q`/`filter`/`sort` を Worker 側で同じ規則
 * （@line-crm/shared）にそろえて処理し、`limit` 未指定なら従来どおり
 * 全件を返す互換をここで固定する。
 */

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

const STORED_LAYOUT = {
  version: 2,
  header: [],
  sections: [{
    id: 'section-1',
    name: '質問',
    blocks: [{
      id: 'block-1', kind: 'input', type: 'text', name: 'q1', label: '名前', required: false,
      destinations: { friendFieldIds: ['field-1'] },
    }],
  }],
  options: {},
};

const PLAIN_LAYOUT = {
  version: 2,
  header: [],
  sections: [{
    id: 'section-1',
    name: '質問',
    blocks: [{ id: 'block-1', kind: 'input', type: 'text', name: 'q1', label: '好きな色', required: false }],
  }],
  options: {},
};

/**
 * 並び・絞り込み・検索が全部効くよう、意図的に性質の違う5件を作る。
 * - form-stored: 公開中・情報欄に保存する・回答あり（新しい）
 * - form-alpha: 公開中・「犬の散歩」という質問・回答あり（古い）
 * - form-beta:  下書き
 * - form-gamma: 公開中・回答なし
 * - form-delta: 下書き
 */
function seed(raw: Database) {
  raw.exec(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
            VALUES ('acc-a','ch-a','A店','token','secret')`);
  const insert = raw.prepare(
    `INSERT INTO forms (id, name, fields, layout, is_active, status, submit_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
  );
  const fields = JSON.stringify([{ name: 'q1', label: '名前', type: 'text' }]);
  insert.run('form-stored', 'アンケート', fields, JSON.stringify(STORED_LAYOUT), 1, 9, '2026-01-05', '2026-01-05');
  insert.run('form-alpha', '習慣調査', JSON.stringify([{ name: 'q1', label: '犬の散歩', type: 'text' }]), JSON.stringify(PLAIN_LAYOUT), 1, 3, '2026-01-01', '2026-01-04');
  insert.run('form-beta', 'ベータ版', fields, JSON.stringify(PLAIN_LAYOUT), 0, 0, '2026-01-03', '2026-01-03');
  insert.run('form-gamma', 'ガンマ', fields, JSON.stringify(PLAIN_LAYOUT), 1, 0, '2026-01-02', '2026-01-02');
  insert.run('form-delta', 'デルタ', fields, JSON.stringify(PLAIN_LAYOUT), 0, 0, '2026-01-04', '2026-01-01');
  const attach = raw.prepare(`INSERT INTO form_accounts (form_id, line_account_id) VALUES (?, 'acc-a')`);
  for (const id of ['form-stored', 'form-alpha', 'form-beta', 'form-gamma', 'form-delta']) attach.run(id);
  // last_submitted_at: stored=新しい / alpha=古い / ほかは回答なし。
  insertFriendRows(raw);
}

function insertFriendRows(raw: Database) {
  insertFriend(raw, 'friend-a', { line_account_id: 'acc-a' });
  const sub = raw.prepare(
    `INSERT INTO form_submissions (id, form_id, friend_id, data, created_at) VALUES (?, ?, 'friend-a', '{}', ?)`,
  );
  sub.run('sub-1', 'form-stored', '2026-02-10T00:00:00.000Z');
  sub.run('sub-2', 'form-alpha', '2026-02-01T00:00:00.000Z');
}

const list = (db: D1Database, suffix = '') =>
  app(db).fetch(new Request(`https://worker.test/api/forms?account_id=acc-a&with_list_summary=1${suffix}`));

type ListBody = {
  data: {
    items: Array<{ id: string }>;
    total: number;
    all_total?: number;
    page: number;
    limit: number;
  };
};

const ids = (body: ListBody) => body.data.items.map((item) => item.id);

describe('#1060 GET /api/forms のサーバーページング', () => {
  it('limit 未指定は従来どおり全件を返す（既定は回答が新しい順）', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    const res = await list(db);
    expect(res.status).toBe(200);
    const body = await res.json() as ListBody;
    expect(body.data.total).toBe(5);
    expect(body.data.items).toHaveLength(5);
    // latest-answer: 回答あり（新しい順）→ 未回答（作成が新しい順）。
    expect(ids(body)).toEqual([
      'form-stored', 'form-alpha', 'form-delta', 'form-beta', 'form-gamma',
    ]);
  });

  it('page/limit で切り出し、total は絞り込み後・all_total は絞り込み前の件数', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    const res = await list(db, '&page=2&limit=2');
    expect(res.status).toBe(200);
    const body = await res.json() as ListBody;
    expect(body.data.total).toBe(5);
    expect(body.data.all_total).toBe(5);
    expect(body.data.page).toBe(2);
    expect(body.data.limit).toBe(2);
    expect(body.data.items).toHaveLength(2);
    // 既定（latest-answer）: 回答あり新しい順 → 未回答は作成が新しい順。
    // 全体順は stored, alpha, delta, beta, gamma で、2ページ目は delta, beta。
    expect(ids(body)).toEqual(['form-delta', 'form-beta']);
  });

  it('filter=draft は公開中を除き、filter=published は下書きを除く', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    const draft = await (await list(db, '&filter=draft')).json() as ListBody;
    expect(ids(draft).sort()).toEqual(['form-beta', 'form-delta']);
    expect(draft.data.total).toBe(2);
    expect(draft.data.all_total).toBe(5);

    const published = await (await list(db, '&filter=published')).json() as ListBody;
    expect(ids(published).sort()).toEqual(['form-alpha', 'form-gamma', 'form-stored']);
  });

  it('filter=stored は保存先のあるフォームだけを返す', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    const body = await (await list(db, '&filter=stored')).json() as ListBody;
    expect(ids(body)).toEqual(['form-stored']);
    expect(body.data.total).toBe(1);
    expect(body.data.all_total).toBe(5);
  });

  it('q はフォーム名・質問文・アカウント名を探す', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    const byQuestion = await (await list(db, `&q=${encodeURIComponent('犬の散歩')}`)).json() as ListBody;
    expect(ids(byQuestion)).toEqual(['form-alpha']);
    const byName = await (await list(db, `&q=${encodeURIComponent('ガンマ')}`)).json() as ListBody;
    expect(ids(byName)).toEqual(['form-gamma']);
  });

  it('sort=answers は回答が多い順、sort=name は名前順', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    const answers = await (await list(db, '&sort=answers')).json() as ListBody;
    expect(ids(answers)[0]).toBe('form-stored');
    expect(ids(answers)[1]).toBe('form-alpha');
    // 名前順はフォームの表示名（displayFormName 済み）で並ぶ。
    // アンケート → ガンマ → デルタ → ベータ版 → 習慣調査。
    const names = await (await list(db, '&sort=name')).json() as ListBody;
    expect(ids(names)).toEqual([
      'form-stored', 'form-gamma', 'form-delta', 'form-beta', 'form-alpha',
    ]);
  });

  it('絞り込み＋ページングを組み合わせても total がずれない', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    const body = await (await list(db, '&filter=published&page=2&limit=2')).json() as ListBody;
    expect(body.data.total).toBe(3);
    expect(body.data.all_total).toBe(5);
    expect(body.data.items).toHaveLength(1);
  });
});
