import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

// N-171/N-179: 回答一覧APIが検索条件を受け取り、ページング前にサーバー側で絞り込む。
// 実 route＋実SQLiteで確かめる。件数・一覧・CSV（ページ巡回）が同じ条件になる。

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: async () => ({
    allowedAccountIds: ['acc-1', 'acc-2'],
    canSeeUnassigned: true,
  }),
  canAccessAllLineAccounts: async () => true,
}));

const { forms } = await import('./forms.js');

function setupApp(testDb: SqliteD1) {
  const app = new Hono<{
    Bindings: { DB: D1Database };
    Variables: { staff: AuthenticatedStaff };
  }>();
  app.use('*', async (c, next) => {
    c.env = { DB: testDb.db } as never;
    c.set('staff', {
      id: 'staff-1',
      name: 'Staff',
      role: 'owner',
      readOnly: false,
      permissionKeys: [],
      assignedLineAccountId: null,
      canAccessDescendantAccounts: false,
      tenantId: 'tenant-1',
    });
    await next();
  });
  app.route('/', forms);
  return app;
}

function seed(testDb: SqliteD1) {
  const raw = testDb.raw;
  raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('acc-1', 'ch-1', '本店', 'tok-1', 'sec-1')`).run();
  raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('acc-2', 'ch-2', '支店', 'tok-2', 'sec-2')`).run();
  raw.prepare(`INSERT INTO friends (id, line_user_id, line_account_id, display_name, is_following)
    VALUES ('friend-1', 'U1', 'acc-1', '山田太郎', 1)`).run();
  raw.prepare(`INSERT INTO friends (id, line_user_id, line_account_id, display_name, is_following)
    VALUES ('friend-2', 'U2', 'acc-1', '佐藤花子', 1)`).run();
  raw.prepare(`INSERT INTO friends (id, line_user_id, line_account_id, display_name, is_following)
    VALUES ('friend-3', 'U3', 'acc-2', '山田次郎', 1)`).run();
  raw.prepare(`INSERT INTO forms (id, name, fields) VALUES ('form-1', 'アンケート', '[]')`).run();
  raw.prepare(`INSERT INTO forms (id, name, fields) VALUES ('form-2', '別フォーム', '[]')`).run();
  raw.prepare(`INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-1', 'acc-1')`).run();
  raw.prepare(`INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-2', 'acc-1')`).run();
  // 25件（limit=10 で3ページ）。一致行は3ページ目に置く。
  for (let index = 0; index < 25; index++) {
    const day = String(index + 1).padStart(2, '0');
    const data = index === 24
      ? JSON.stringify({ q1: '駐車場の案内がほしい' })
      : JSON.stringify({ q1: `ふつうの回答${index}` });
    raw.prepare(`INSERT INTO form_submissions (id, form_id, friend_id, data, created_at)
      VALUES (?, 'form-1', 'friend-2', ?, ?)`)
      .run(`sub-${day}`, data, `2026-08-${day} 10:00:00`);
  }
  // 特殊文字を含む行（% を文字どおりに探せるか）。
  raw.prepare(`INSERT INTO form_submissions (id, form_id, friend_id, data, created_at)
    VALUES ('sub-spec', 'form-1', 'friend-2', ?, '2026-09-01 10:00:00')`)
    .run(JSON.stringify({ q1: '満足度100%でした' }));
  // 別フォームの一致行（出てはいけない）。
  raw.prepare(`INSERT INTO form_submissions (id, form_id, friend_id, data, created_at)
    VALUES ('sub-other-form', 'form-2', 'friend-2', ?, '2026-09-02 10:00:00')`)
    .run(JSON.stringify({ q1: '駐車場の案内がほしい' }));
  // 別アカウントの友だちの一致行（account_id=acc-1 では出てはいけない）。
  raw.prepare(`INSERT INTO form_submissions (id, form_id, friend_id, data, created_at)
    VALUES ('sub-other-account', 'form-1', 'friend-3', ?, '2026-09-03 10:00:00')`)
    .run(JSON.stringify({ q1: '駐車場の案内がほしい' }));
}

function list(app: ReturnType<typeof setupApp>, params: string) {
  return app.request(`/api/forms/form-1/submissions?account_id=acc-1&${params}`);
}

describe('N-171/N-179 回答のサーバー側検索', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  test('別ページの一致行が検索結果に出て、件数も一致する', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const app = setupApp(testDb);
    const res = await list(app, 'page=1&limit=10&q=' + encodeURIComponent('駐車場'));
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { items: Array<{ id: string }>; total: number } };
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(1);
    expect(body.data.items.map((item) => item.id)).toEqual(['sub-25']);
  });

  test('一致なしは0件', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const app = setupApp(testDb);
    const res = await list(app, 'page=1&limit=10&q=' + encodeURIComponent('存在しない語'));
    const body = await res.json() as { success: boolean; data: { items: unknown[]; total: number } };
    expect(body.data.total).toBe(0);
    expect(body.data.items).toEqual([]);
  });

  test('特殊文字%は文字どおりに探し、何にでも一致しない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const app = setupApp(testDb);
    const res = await list(app, 'page=1&limit=50&q=' + encodeURIComponent('100%'));
    const body = await res.json() as { success: boolean; data: { items: Array<{ id: string }>; total: number } };
    expect(body.data.total).toBe(1);
    expect(body.data.items.map((item) => item.id)).toEqual(['sub-spec']);
  });

  test('別フォーム・別アカウントの一致行は出ない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const app = setupApp(testDb);
    const res = await list(app, 'page=1&limit=50&q=' + encodeURIComponent('駐車場'));
    const body = await res.json() as { success: boolean; data: { items: Array<{ id: string }>; total: number } };
    expect(body.data.items.map((item) => item.id)).not.toContain('sub-other-form');
    expect(body.data.items.map((item) => item.id)).not.toContain('sub-other-account');
  });

  test('名前でも探せる', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const app = setupApp(testDb);
    const res = await list(app, 'page=1&limit=50&q=' + encodeURIComponent('山田太郎'));
    const body = await res.json() as { success: boolean; data: { total: number } };
    expect(body.data.total).toBe(0);
    const res2 = await list(app, 'page=1&limit=50&q=' + encodeURIComponent('佐藤'));
    const body2 = await res2.json() as { success: boolean; data: { total: number } };
    expect(body2.data.total).toBe(26);
  });

  test('未検索は従来どおり全件ページング', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const app = setupApp(testDb);
    const res = await list(app, 'page=1&limit=10');
    const body = await res.json() as { success: boolean; data: { items: unknown[]; total: number } };
    expect(body.data.total).toBe(26);
    expect(body.data.items).toHaveLength(10);
  });

  test('CSV巡回と同じ条件で全一致行が取れる', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const app = setupApp(testDb);
    // 検索語に2件一致させる：sub-25（駐車場）と sub-spec（%）…ではなく、
    // 「回答」でふつう行25件に一致する条件をページ巡回する。
    const found: string[] = [];
    let page = 1;
    let total = 0;
    for (;;) {
      const res = await list(app, `page=${page}&limit=10&q=` + encodeURIComponent('ふつう'));
      const body = await res.json() as { success: boolean; data: { items: Array<{ id: string }>; total: number } };
      total = body.data.total;
      found.push(...body.data.items.map((item) => item.id));
      if (found.length >= total || page > 100) break;
      page += 1;
    }
    expect(total).toBe(24);
    expect(found).toHaveLength(24);
  });
});
