/*
 * POST /api/forms/:id/unarchive — 保管の取り消し（B 元に戻す）。
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

function formRow(id: string) {
  return sqlite.raw.prepare(
    `SELECT status, is_active, archived_at, revision FROM forms WHERE id = ?`,
  ).get(id) as { status: string; is_active: number; archived_at: string | null; revision: number };
}

async function unarchive(id: string, body: Record<string, unknown>) {
  return app().request(
    `/api/forms/${id}/unarchive?account_id=acc-1`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
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
    `INSERT INTO forms (id, name, fields, is_active, status, archived_at, revision, created_at, updated_at)
     VALUES ('form-1', '保管中の申込', '[]', 0, 'archived', '2026-09-20T00:00:00.000+09:00', 5, '2026-09-01T00:00:00.000+09:00', '2026-09-20T00:00:00.000+09:00')`,
  ).run();
  sqlite.raw.prepare(
    `INSERT INTO forms (id, name, fields, is_active, status, revision, created_at, updated_at)
     VALUES ('form-2', '現行の申込', '[]', 1, 'active', 3, '2026-09-01T00:00:00.000+09:00', '2026-09-01T00:00:00.000+09:00')`,
  ).run();
  sqlite.raw.prepare(
    `INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-1', 'acc-1'), ('form-2', 'acc-1')`,
  ).run();
});

describe('POST /api/forms/:id/unarchive の取り消し', () => {
  test('保管中→現行へ戻り、戻した直後は受付停止のまま', async () => {
    // 植えた直後の版を読む（保存時に版が進むことがあるため直書きしない）。
    const current = formRow('form-1').revision;
    const res = await unarchive('form-1', { expectedRevision: current });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: { status: 'active', isActive: false },
    });
    const row = formRow('form-1');
    expect(row.status).toBe('active');
    expect(row.is_active).toBe(0);
    expect(row.archived_at).toBeNull();
    expect(row.revision).toBe(current + 1);
  });

  test('保管されていない行は409。版ずれも409', async () => {
    const notArchived = await unarchive('form-2', { expectedRevision: 3 });
    expect(notArchived.status).toBe(409);
    await expect(notArchived.json()).resolves.toMatchObject({ error: 'form_not_archived' });
    expect(formRow('form-2').status).toBe('active');

    const stale = await unarchive('form-1', { expectedRevision: 4 });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: 'form_delete_changed' });
    expect(formRow('form-1').status).toBe('archived');
  });

  test('無い行は404。版なしは400', async () => {
    expect((await unarchive('no-such-form', { expectedRevision: 1 })).status).toBe(404);
    expect((await unarchive('form-1', {})).status).toBe(400);
  });
});
