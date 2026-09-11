/*
 * PUT /api/forms/:id の版競合(#723)。
 *
 * 実DB（better-sqlite3 + bootstrap.sql）に実物のルートを当てる。モックは
 * 役割の門番が見る staff だけで、保存の経路は本物のまま通す。
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
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
