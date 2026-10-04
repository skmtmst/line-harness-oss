/*
 * 回答フォームごとの見た目（M3・migration 562）。
 *
 * 実DB（better-sqlite3 + bootstrap.sql）に実物のルートを当てる。
 * 合格の条件: 既定は店の設定に合わせる・このフォームだけ変えるを
 * 保存して読み出せる・形の間違いは 400 で断る・複製は引き継ぐ。
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

const NOW = '2026-10-04T00:00:00.000+09:00';
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

async function getForm() {
  const res = await app().request('/api/forms/form-1?account_id=acc-1', {}, env());
  expect(res.status).toBe(200);
  const body = await res.json() as { data: Record<string, unknown> };
  return body.data;
}

async function putForm(appearance: unknown) {
  return app().request(
    '/api/forms/form-1?account_id=acc-1',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liffAppearance: appearance, expectedContentRevision: currentRevision() }),
    },
    env(),
  );
}

function currentRevision(): number {
  const row = sqlite.raw.prepare(`SELECT content_revision FROM forms WHERE id = 'form-1'`).get() as {
    content_revision: number;
  };
  return row.content_revision;
}

beforeEach(() => {
  sqlite = createTestD1();
  sqlite.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('acc-1', 'ch-1', '本店', 't', 's')`,
  ).run();
  sqlite.raw.prepare(
    `INSERT INTO forms (id, name, description, fields, layout, save_to_metadata,
                        is_active, submit_count, created_at, updated_at)
     VALUES ('form-1', '申込フォーム', '説明', '[]', NULL, 1, 1, 0, ?, ?)`,
  ).run(NOW, NOW);
  sqlite.raw.prepare(
    `INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-1', 'acc-1')`,
  ).run();
});

describe('回答フォームの見た目（M3）', () => {
  test('既定は店の設定に合わせる', async () => {
    const data = await getForm();
    expect(data.liffAppearance).toEqual({
      mode: 'inherit',
      theme: 'line',
      primaryColor: null,
      backgroundColor: null,
      headingFont: 'default',
    });
  });

  test('このフォームだけ変えるを保存し、そのまま読み出せる', async () => {
    const res = await putForm({
      mode: 'custom',
      theme: 'night',
      primaryColor: '#c9a96a',
      backgroundColor: '#0f1c33',
      headingFont: 'serif',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data.liffAppearance).toEqual({
      mode: 'custom',
      theme: 'night',
      primaryColor: '#c9a96a',
      backgroundColor: '#0f1c33',
      headingFont: 'serif',
    });
    expect(await getForm()).toMatchObject({
      liffAppearance: {
        mode: 'custom',
        theme: 'night',
        primaryColor: '#c9a96a',
        backgroundColor: '#0f1c33',
        headingFont: 'serif',
      },
    });
  });

  test('店の設定に合わせるに戻しても値は残る', async () => {
    expect((await putForm({ mode: 'custom', theme: 'night', primaryColor: '#c9a96a' })).status).toBe(200);
    const res = await putForm({ mode: 'inherit' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data.liffAppearance).toEqual({
      mode: 'inherit',
      theme: 'night',
      primaryColor: '#c9a96a',
      backgroundColor: null,
      headingFont: 'default',
    });
  });

  test('形が違う見た目は 400 で保存しない', async () => {
    for (const appearance of [
      { mode: 'store' },
      { theme: 'midnight' },
      { primaryColor: 'gold' },
      { backgroundColor: '#12345' },
      { headingFont: 'comic' },
      'custom',
    ]) {
      const res = await putForm(appearance);
      expect(res.status).toBe(400);
    }
    // 1件も保存されていない（版も進まない）。
    expect(currentRevision()).toBe(1);
    expect(await getForm()).toMatchObject({
      liffAppearance: { mode: 'inherit', theme: 'line' },
    });
  });

  test('複製は見た目を引き継ぐ', async () => {
    expect((await putForm({ mode: 'custom', theme: 'gentle' })).status).toBe(200);
    const res = await app().request(
      '/api/forms/form-1/duplicate?account_id=acc-1',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      env(),
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data.liffAppearance).toMatchObject({ mode: 'custom', theme: 'gentle' });
  });
});
