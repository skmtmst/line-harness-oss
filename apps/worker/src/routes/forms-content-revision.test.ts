/*
 * PUT /api/forms/:id の版競合(#723)。
 *
 * 実DB（better-sqlite3 + bootstrap.sql）に実物のルートを当てる。モックは
 * 役割の門番が見る staff だけで、保存の経路は本物のまま通す。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';

vi.mock('../services/friend-tag-attach.js', () => ({
  attachTagAndFireSideEffects: vi.fn(),
}));
vi.mock('../services/event-bus.js', () => ({
  fireEvent: vi.fn().mockResolvedValue(undefined),
  logOutgoingMessage: vi.fn().mockResolvedValue(undefined),
}));

const { forms } = await import('./forms.js');

const NOW = '2026-09-11T00:00:00.000+09:00';
let sqlite: SqliteD1;

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', role: 'owner', name: '店長' } as never);
    return next();
  });
  instance.route('/', forms);
  return instance;
}

function env() {
  return { DB: sqlite.db } as unknown as Env['Bindings'];
}

function formRow() {
  return sqlite.raw.prepare(
    `SELECT name, is_active, revision, content_revision FROM forms WHERE id = 'form-1'`,
  ).get() as { name: string; is_active: number; revision: number; content_revision: number };
}

async function put(body: Record<string, unknown>) {
  return app().request(
    '/api/forms/form-1?account_id=acc-1',
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    env(),
  );
}

beforeEach(() => {
  sqlite = createTestD1();
  sqlite.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('acc-1', 'ch-1', '本店', 't', 's')`,
  ).run();
  sqlite.raw.prepare(
    `INSERT INTO forms (id, name, description, fields, is_active, created_at, updated_at)
     VALUES ('form-1', '元の名前', '元の説明', '[]', 1, ?, ?)`,
  ).run(NOW, NOW);
  sqlite.raw.prepare(
    `INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-1', 'acc-1')`,
  ).run();
});

afterEach(() => sqlite.raw.close());

describe('PUT /api/forms/:id の版競合', () => {
  test('版を送らないと 400。保存しない', async () => {
    const res = await put({ name: '版なしで保存' });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: '確認した版が必要です' });
    expect(formRow().name).toBe('元の名前');
  });

  test('整数でない版・0以下の版も 400', async () => {
    for (const value of ['1', 1.5, 0, -1, null]) {
      const res = await put({ name: 'だめな版', expectedContentRevision: value });
      expect(res.status).toBe(400);
    }
    expect(formRow().name).toBe('元の名前');
  });

  test('確認した版と一致すれば保存でき、応答に次の版が入る', async () => {
    const before = formRow().content_revision;
    const res = await put({ name: '新しい名前', expectedContentRevision: before });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { contentRevision: number } };
    expect(body.data.contentRevision).toBe(before + 1);
    expect(formRow().name).toBe('新しい名前');
  });

  test('古い版で保存すると 409。内容は変わらず、画面に出す材料が返る', async () => {
    const before = formRow().content_revision;
    expect((await put({ name: 'Aさん', expectedContentRevision: before })).status).toBe(200);

    // Bさんは開いた時点の版のまま保存しようとする。
    const res = await put({ name: 'Bさん', expectedContentRevision: before });
    expect(res.status).toBe(409);
    const body = await res.json() as {
      error: string; message: string; data: { contentRevision: number; updatedAt: string };
    };
    expect(body.error).toBe('form_content_changed');
    expect(body.message).toContain('ほかの人が先に保存しました');
    // 画面が「いつ保存されたか」を出せる。
    expect(body.data.contentRevision).toBe(before + 1);
    expect(typeof body.data.updatedAt).toBe('string');
    // Aさんの内容が残っている。
    expect(formRow().name).toBe('Aさん');
  });

  test('来訪・回答で版が進んでも、編集の保存は通る', async () => {
    const before = formRow().content_revision;
    sqlite.raw.prepare(
      `INSERT INTO form_opens (id, form_id, opened_at) VALUES ('open-1', 'form-1', ?)`,
    ).run(NOW);
    sqlite.raw.prepare(
      `INSERT INTO form_submissions (id, form_id, data, created_at) VALUES ('sub-1', 'form-1', '{}', ?)`,
    ).run(NOW);
    // 影響の版（revision）は進んでいる。
    expect(formRow().revision).toBeGreaterThan(1);

    const res = await put({ name: '来訪後でも保存できる', expectedContentRevision: before });
    expect(res.status).toBe(200);
    expect(formRow().name).toBe('来訪後でも保存できる');
  });

  test('受付停止（1項目だけ）も版を要求し、版を増やす', async () => {
    const before = formRow().content_revision;
    expect((await put({ isActive: false })).status).toBe(400);
    expect(formRow().is_active).toBe(1);

    const res = await put({ isActive: false, expectedContentRevision: before });
    expect(res.status).toBe(200);
    expect(formRow().is_active).toBe(0);
    expect(formRow().content_revision).toBe(before + 1);

    // そのあと編集画面が古い版で保存しても、公開中に戻らない。
    const stale = await put({ name: '編集画面の保存', isActive: true, expectedContentRevision: before });
    expect(stale.status).toBe(409);
    expect(formRow().is_active).toBe(0);
  });

  test('見つからないフォームは 404（409 と分ける）', async () => {
    const res = await app().request(
      '/api/forms/missing?account_id=acc-1',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', expectedContentRevision: 1 }) },
      env(),
    );
    expect(res.status).toBe(404);
  });

  test('詳細の応答に編集の版が入る（画面がここから持つ）', async () => {
    const res = await app().request('/api/forms/form-1?account_id=acc-1', {}, env());
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { contentRevision: number; revision: number } };
    expect(body.data.contentRevision).toBe(formRow().content_revision);
    expect(body.data.revision).toBe(formRow().revision);
  });
});


describe('W15 フォルダと内容の複合保存（実SQL）', () => {
  function state() {
    return sqlite.raw.prepare(`SELECT name, layout, fields, folder_id, updated_at, revision, content_revision
      FROM forms WHERE id = 'form-1'`).get();
  }
  beforeEach(() => {
    sqlite.raw.exec(`INSERT INTO folders (id, kind, name, account_id) VALUES ('folder-1', 'form', '移動先', 'acc-1')`);
  });
  test('古い版の409ではフォルダ・内容・時刻がすべて元のまま', async () => {
    const revision = formRow().content_revision;
    expect((await put({ name: '先に保存', expectedContentRevision: revision })).status).toBe(200);
    const before = state();
    const response = await put({ folderId: 'folder-1', name: '古い編集', expectedContentRevision: revision });
    expect(response.status).toBe(409);
    expect(state()).toEqual(before);
  });
  test('不正layoutの400でフォルダだけが動かない', async () => {
    const before = state();
    expect((await put({ folderId: 'folder-1', layout: null, expectedContentRevision: 1 })).status).toBe(400);
    expect(state()).toEqual(before);
  });
  test('配色違反の422でフォルダだけが動かない', async () => {
    const before = state();
    const layout = { sections: [], options: { theme: { text: '#ffffff', sub: '#ffffff' } } };
    expect((await put({ folderId: 'folder-1', layout, expectedContentRevision: 1 })).status).toBe(422);
    expect(state()).toEqual(before);
  });
  test('正しい版で内容とフォルダが一緒に保存され版は一度だけ進む', async () => {
    const before = formRow();
    expect((await put({ folderId: 'folder-1', name: '移動と編集', expectedContentRevision: before.content_revision })).status).toBe(200);
    expect(state()).toMatchObject({ name: '移動と編集', folder_id: 'folder-1',
      content_revision: before.content_revision + 1, revision: before.revision + 1 });
  });
  test('版を読んだ後に別編集が確定してもUPDATEのCASで移動を止める', async () => {
    const original = sqlite.db.prepare.bind(sqlite.db);
    let competingState: unknown;
    const db = { ...sqlite.db, prepare(sql: string) {
      if (sql.includes('UPDATE forms\n')) {
        sqlite.raw.exec(`UPDATE forms SET name = '並行編集', content_revision = content_revision + 1,
          revision = revision + 1 WHERE id = 'form-1'`);
        competingState = state();
      }
      return original(sql);
    } } as D1Database;
    const response = await app().request('/api/forms/form-1?account_id=acc-1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '古い保存', folderId: 'folder-1', expectedContentRevision: 1 }),
    }, { DB: db } as Env['Bindings']);
    expect(response.status).toBe(409);
    expect(state()).toEqual(competingState);
  });
  test('フォルダだけの移動と未分類化は編集版と削除確認版を増やさない', async () => {
    const before = formRow();
    for (const folderId of ['folder-1', null]) {
      expect((await put({ folderId })).status).toBe(200);
      expect(formRow()).toEqual(before);
      expect(state()).toMatchObject({ folder_id: folderId });
    }
  });
  test('フォルダを送らない編集は並行のフォルダ移動を上書きしない', async () => {
    // UPDATE直前に独立した一覧のフォルダ移動を差し込む。
    const original = sqlite.db.prepare.bind(sqlite.db);
    const db = { ...sqlite.db, prepare(sql: string) {
      if (sql.includes('UPDATE forms\n')) {
        sqlite.raw.exec(`UPDATE forms SET folder_id = 'folder-1' WHERE id = 'form-1'`);
      }
      return original(sql);
    } } as D1Database;
    const response = await app().request('/api/forms/form-1?account_id=acc-1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '内容だけ', expectedContentRevision: 1 }),
    }, { DB: db } as Env['Bindings']);
    expect(response.status).toBe(200);
    expect(state()).toMatchObject({ name: '内容だけ', folder_id: 'folder-1', content_revision: 2 });
  });
});
