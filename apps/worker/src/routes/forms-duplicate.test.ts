/*
 * POST /api/forms/:id/duplicate — フォーム全体の複製(R230)。
 *
 * 実DB（better-sqlite3 + bootstrap.sql）に実物のルートを当てる。モックは
 * 役割の門番が見る staff だけで、保存の経路は本物のまま通す。
 *
 * 合格の条件: 質問・分岐・受付設定を保持した独立の停止中フォームができる。
 * 元の回答・公開状態・集計は複製しない。
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

async function duplicate(id: string, body?: Record<string, unknown>) {
  return app().request(
    `/api/forms/${id}/duplicate?account_id=acc-1`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) },
    env(),
  );
}

beforeEach(() => {
  sqlite = createTestD1();
  sqlite.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('acc-1', 'ch-1', '本店', 't', 's')`,
  ).run();
  // 公開中・回答あり・受付設定ありの元フォーム。
  sqlite.raw.prepare(
    `INSERT INTO forms (id, name, description, fields, layout, on_submit_tag_id,
                        on_submit_message_type, on_submit_message_content,
                        save_to_metadata, is_active, submit_count, created_at, updated_at)
     VALUES ('form-1', '元の名前', '元の説明', '[{"name":"q1"}]', '{"blocks":[]}', 'tag-1',
             'text', '回答ありがとう', 1, 1, 5, ?, ?)`,
  ).run(NOW, NOW);
  sqlite.raw.prepare(
    `INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-1', 'acc-1')`,
  ).run();
  sqlite.raw.prepare(
    `INSERT INTO form_submissions (id, form_id, data, created_at)
     VALUES ('sub-1', 'form-1', '{}', ?)`,
  ).run(NOW);
});

describe('POST /api/forms/:id/duplicate（R230）', () => {
  test('中身を引き継いだ別IDの停止中フォームができる', async () => {
    const res = await duplicate('form-1');
    expect(res.status).toBe(201);
    const body = await res.json() as { data: Record<string, unknown> };
    const copy = body.data;
    expect(copy.id).not.toBe('form-1');
    expect(copy.name).toBe('元の名前の複製');
    expect(copy.isActive).toBe(false);
    // 質問・受付設定は保持する。
    expect(copy.onSubmitTagId).toBe('tag-1');
    expect(copy.onSubmitMessageContent).toBe('回答ありがとう');
    // 集計は引き継がない。
    expect(copy.submitCount).toBe(0);
    expect(copy.currentPublishedVersionId ?? copy.publishedVersionId ?? null).toBeNull();

    const rows = sqlite.raw.prepare(
      `SELECT id, is_active, submit_count, current_published_version_id FROM forms`,
    ).all() as { id: string; is_active: number; submit_count: number; current_published_version_id: string | null }[];
    expect(rows.map((row) => row.id)).toHaveLength(2);
    const copyRow = rows.find((row) => row.id !== 'form-1')!;
    // DBでも受付停止・集計0・公開版なし。
    expect(copyRow.is_active).toBe(0);
    expect(copyRow.submit_count).toBe(0);
    expect(copyRow.current_published_version_id).toBeNull();
    // 元の回答は元のフォームに残り、複製には付かない。
    const submissions = sqlite.raw.prepare(`SELECT form_id FROM form_submissions`).all() as { form_id: string }[];
    expect(submissions).toEqual([{ form_id: 'form-1' }]);
    // 元は公開中のまま。
    const source = sqlite.raw.prepare(`SELECT is_active FROM forms WHERE id = 'form-1'`).get() as { is_active: number };
    expect(source.is_active).toBe(1);
  });

  test('名前を指定できる', async () => {
    const res = await duplicate('form-1', { name: '用途違いの写し' });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { name: string } };
    expect(body.data.name).toBe('用途違いの写し');
  });

  test('無いフォームは 404。何も作らない', async () => {
    const res = await duplicate('no-such-form');
    expect(res.status).toBe(404);
    const rows = sqlite.raw.prepare(`SELECT id FROM forms`).all() as { id: string }[];
    expect(rows.map((row) => row.id)).toEqual(['form-1']);
  });
});
