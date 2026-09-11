import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

/**
 * `GET /api/folders` の件数（#631）を、本物の `@line-crm/db`（`getFolderItemCounts`
 * を含む）と実スキーマ（bootstrap.sql）を使って結合で確かめる。
 *
 * `friend-attributes.test.ts` は `@line-crm/db` を丸ごとモックしており、
 * 「正しい引数で呼ばれたか」までしか見ていない。ここは Worker のルーティング
 * から実DBの集計まで、実際につながっていることを見る。差し替えるのは
 * `account-access.js`（スコープの計算ロジック自体は既存の別機能）だけ。
 */

/**
 * `packages/db/test/d1-test-helper.ts` は apps/worker の tsconfig rootDir
 * の外にあり import できない（他のworkerテストと同じく、ここでも複製する）。
 */
function asD1(sqlite: Database.Database): D1Database {
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      const bound = (params: unknown[]): D1PreparedStatement => ({
        bind: (...next: unknown[]) => bound(next),
        all: async <T>() => ({ success: true, results: statement.all(...params) as T[], meta: {} }),
        first: async <T>() => (statement.get(...params) as T | undefined) ?? null,
        run: async <T>() => {
          const result = statement.run(...params);
          return { success: true, results: [], meta: { changes: result.changes } } as T;
        },
        raw: async () => [],
      } as unknown as D1PreparedStatement);
      return bound([]);
    },
  };
  return db as unknown as D1Database;
}

const accountAccess = {
  getVisibleLineAccountScope: vi.fn(),
};
vi.mock('../services/account-access.js', () => accountAccess);

const { friendAttributes } = await import('./friend-attributes.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_ROOT = join(__dirname, '..', '..', '..', '..', 'packages', 'db');

function makeApp() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'u-1', name: 'テスト', role: 'owner', readOnly: false, tenantId: 'tenant-1' });
    return next();
  });
  app.route('/', friendAttributes);
  return app;
}

let sqlite: Database.Database;
let env: Env;

function req(path: string) {
  return makeApp().fetch(new Request(`https://example.com${path}`), env);
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(DB_ROOT, 'bootstrap.sql'), 'utf8'));
  env = { DB: asD1(sqlite) } as unknown as Env;

  sqlite.prepare(`INSERT INTO line_accounts (id, name, channel_id, channel_secret, channel_access_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '2026-01-01', '2026-01-01')`).run('account-a', 'A店', 'c-a', 's-a', 't-a');
  sqlite.prepare(`INSERT INTO line_accounts (id, name, channel_id, channel_secret, channel_access_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '2026-01-01', '2026-01-01')`).run('account-b', 'B店', 'c-b', 's-b', 't-b');

  sqlite.prepare(`INSERT INTO folders (id, kind, name, display_order, created_at, updated_at)
    VALUES ('folder-1', 'reminder', 'フォルダ1', 0, '2026-01-01', '2026-01-01')`).run();

  const insertReminder = sqlite.prepare(
    `INSERT INTO reminders (id, name, trigger_type, folder_id, line_account_id, created_at, updated_at)
     VALUES (?, ?, 'manual', ?, ?, '2026-01-01', '2026-01-01')`,
  );
  insertReminder.run('r-a1', 'A1', 'folder-1', 'account-a');
  insertReminder.run('r-a2', 'A2', 'folder-1', 'account-a');
  // 他アカウント(account-b)の行。境界確認用。
  insertReminder.run('r-b1', 'B1', 'folder-1', 'account-b');
  insertReminder.run('r-b2', 'B2', 'folder-1', 'account-b');
  insertReminder.run('r-b3', 'B3', 'folder-1', 'account-b');
});

describe('GET /api/folders の件数(#631) — 実DB結合', () => {
  it('選択中アカウントの行だけを、実DBから数える(他アカウントの行が混ざらない)', async () => {
    accountAccess.getVisibleLineAccountScope.mockResolvedValue({
      accounts: [], allowedAccountIds: ['account-a'], canSeeUnassigned: false, ids: ['account-a'], isAccountScoped: true,
    });

    const res = await req('/api/folders?kind=reminder');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string; itemCount?: number }>; unfiledCount?: number };
    const folder1 = body.data.find((f) => f.id === 'folder-1');
    expect(folder1?.itemCount).toBe(2);
    // 他アカウント(account-b)の3件が混ざれば5になる。混ざっていないことが本題。
    expect(folder1?.itemCount).not.toBe(5);
  });

  it('両アカウントを見られる担当者には、合算した件数が返る', async () => {
    accountAccess.getVisibleLineAccountScope.mockResolvedValue({
      accounts: [], allowedAccountIds: ['account-a', 'account-b'], canSeeUnassigned: false, ids: [], isAccountScoped: false,
    });

    const res = await req('/api/folders?kind=reminder');
    const body = await res.json() as { data: Array<{ id: string; itemCount?: number }> };
    expect(body.data.find((f) => f.id === 'folder-1')?.itemCount).toBe(5);
  });

  it('対応表に無い種別(#730)は itemCount を返さない(0とは書かない)', async () => {
    accountAccess.getVisibleLineAccountScope.mockResolvedValue({
      accounts: [], allowedAccountIds: ['account-a'], canSeeUnassigned: false, ids: ['account-a'], isAccountScoped: true,
    });
    sqlite.prepare(`INSERT INTO folders (id, kind, name, display_order, created_at, updated_at)
      VALUES ('folder-media', 'media', 'メディア用', 0, '2026-01-01', '2026-01-01')`).run();

    const res = await req('/api/folders?kind=media');
    const body = await res.json() as { data: Array<Record<string, unknown>>; unfiledCount?: number };
    expect(body.data[0]).not.toHaveProperty('itemCount');
    expect(body.unfiledCount).toBeUndefined();
  });

  it('kind を指定しない呼び出しは itemCount を数えない', async () => {
    accountAccess.getVisibleLineAccountScope.mockResolvedValue({
      accounts: [], allowedAccountIds: ['account-a'], canSeeUnassigned: false, ids: ['account-a'], isAccountScoped: true,
    });
    const res = await req('/api/folders');
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    for (const row of body.data) expect(row).not.toHaveProperty('itemCount');
    expect(accountAccess.getVisibleLineAccountScope).not.toHaveBeenCalled();
  });
});
