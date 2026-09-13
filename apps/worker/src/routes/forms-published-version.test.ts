import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createForm } from '@line-crm/db';
import { emptyLayout } from '@line-crm/shared';
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

let sqlite: SqliteD1;

function env() {
  return { DB: sqlite.db } as unknown as Env['Bindings'];
}

function app(admin: boolean) {
  const instance = new Hono<Env>();
  if (admin) {
    instance.use('*', async (c, next) => {
      c.set('staff', { id: 'owner-1', role: 'owner', name: '店長' } as never);
      return next();
    });
  }
  instance.route('/', forms);
  return instance;
}

function publicGet(id: string) {
  return app(false).request(`/api/forms/${id}`, {}, env());
}

function adminRequest(path: string, method: 'PUT' | 'POST', body: Record<string, unknown>) {
  return app(true).request(
    `${path}?account_id=account-a`,
    { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    env(),
  );
}

beforeEach(() => {
  sqlite = createTestD1();
  sqlite.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-a', 'channel-a', '本店', 'token', 'secret')`,
  ).run();
});

describe('フォームの不変公開版 (N-166)', () => {
  test('編集保存では公開内容を変えず、公開操作で初めて参照先を切り替える', async () => {
    const initial = emptyLayout();
    initial.header.push({
      id: 'old-title', kind: 'heading', text: '公開中の見出し', level: 1,
    });
    const created = await createForm(sqlite.db, {
      name: '公開中の名前', fields: '[]', layout: JSON.stringify(initial),
      lineAccountIds: ['account-a'],
    });

    const before = await publicGet(created.id);
    expect(before.status).toBe(200);
    await expect(before.json()).resolves.toMatchObject({
      data: { name: '公開中の名前' },
    });

    const draft = emptyLayout();
    draft.header.push({
      id: 'new-title', kind: 'heading', text: '編集中の見出し', level: 1,
    });
    const saved = await adminRequest(`/api/forms/${created.id}`, 'PUT', {
      name: '編集中の名前', layout: draft, expectedContentRevision: 1,
    });
    expect(saved.status).toBe(200);
    const savedBody = await saved.json() as { data: { contentRevision: number } };

    const whileEditing = await publicGet(created.id);
    await expect(whileEditing.json()).resolves.toMatchObject({
      data: { name: '公開中の名前' },
    });
    const loggedInPublicView = await app(true).request(`/api/forms/${created.id}`, {}, env());
    await expect(loggedInPublicView.json()).resolves.toMatchObject({
      data: { name: '公開中の名前' },
    });

    const published = await adminRequest(`/api/forms/${created.id}/publish`, 'POST', {
      expectedContentRevision: savedBody.data.contentRevision,
    });
    expect(published.status).toBe(200);
    await expect(published.json()).resolves.toMatchObject({
      data: { versionNumber: 2, replayed: false },
    });

    const after = await publicGet(created.id);
    await expect(after.json()).resolves.toMatchObject({
      data: { name: '編集中の名前' },
    });
    expect(sqlite.raw.prepare(
      `SELECT COUNT(*) AS count FROM form_versions WHERE form_id = ?`,
    ).get(created.id)).toEqual({ count: 2 });
  });

  test('同じ編集版の公開を再送しても版を増やさず、公開済み版は書き換えられない', async () => {
    const created = await createForm(sqlite.db, {
      name: '公開内容', fields: '[]', layout: JSON.stringify(emptyLayout()),
      lineAccountIds: ['account-a'],
    });
    const replay = await adminRequest(`/api/forms/${created.id}/publish`, 'POST', {
      expectedContentRevision: 1,
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ data: { replayed: true } });
    expect(sqlite.raw.prepare(
      `SELECT COUNT(*) AS count FROM form_versions WHERE form_id = ?`,
    ).get(created.id)).toEqual({ count: 1 });
    expect(() => sqlite.raw.prepare(
      `UPDATE form_versions SET name = '改ざん' WHERE form_id = ?`,
    ).run(created.id)).toThrow('published form versions are immutable');
  });

  test('未公開の下書きは公開URLから取得できない', async () => {
    const draft = await createForm(sqlite.db, {
      name: '下書き', fields: '[]', layout: JSON.stringify(emptyLayout()),
      isActive: false, lineAccountIds: ['account-a'],
    });
    expect((await publicGet(draft.id)).status).toBe(404);
  });
});
