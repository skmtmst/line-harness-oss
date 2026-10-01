import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMiddleware } from '../middleware/auth.js';
import { friendAttributes } from './friend-attributes.js';

/*
 * R540〜R544（対応マーク・自動変更ルール）の最新枝での照合。
 *
 * 監査は古いSHA（918b8cdb）で行われた。D028〜D035・#1032 で直ったものは
 * コードを変えず「最新では再現しない」ことをここで証拠立てる。
 * R540（画面の切替中の古い一覧）は画面側の試験で見る。
 *
 * 実ルート＋実認証＋メモリSQLite＋失敗注入で確かめる。
 */

const BOOTSTRAP_SQL = readFileSync(
  join(import.meta.dirname, '../../../../packages/db/bootstrap.sql'),
  'utf8',
);
const TENANT = '00000000-0000-4000-8000-000000000001';

const OWNER_KEY = 'r540-owner';

function setupSqlite() {
  const sqlite = new Database(':memory:');
  sqlite.exec(BOOTSTRAP_SQL);
  sqlite.prepare(
    `INSERT INTO line_accounts (id, name, channel_id, channel_access_token, channel_secret)
     VALUES ('acc-1', 'アカウント1', 'ch-1', 'token', 'secret')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO staff_members
       (id, name, email, role, access_level, api_key, is_active, invite_status, tenant_id, permission_keys, view_permission_keys, account_scope)
     VALUES
       ('st-owner', 'オーナー', 'o@example.com', 'owner', 'full', ?, 1, 'active', ?, '[]', '[]', 'all')`,
  ).run(OWNER_KEY, TENANT);
  const ins = sqlite.prepare(
    `INSERT INTO support_marks (id, name, color, is_default, auto_on_inbound, display_order, created_at, version, updated_at)
     VALUES (?, ?, '#EF4B55', ?, 0, ?, '2026-01-01T00:00:00.000', 1, '2026-01-01T00:00:00.000')`,
  );
  ins.run('mk-own', '独自マーク', 0, 0);
  ins.run('mk-def', '既定マーク', 1, 1);
  const insScope = sqlite.prepare(
    `INSERT INTO support_mark_scopes (mark_id, tenant_id, line_account_id, created_at)
     VALUES (?, ?, ?, '2026-01-01T00:00:00.000')`,
  );
  insScope.run('mk-own', TENANT, 'acc-1');
  insScope.run('mk-def', TENANT, 'acc-1');
  return sqlite;
}

function asD1(sqlite: Database.Database, failOn: string[] = []): D1Database {
  const shouldFail = (q: string) => failOn.some((p) => q.includes(p));
  return {
    prepare(query: string) {
      const build = (...params: unknown[]) => {
        if (shouldFail(query)) {
          const boom = () => { throw new Error(`injected failure: ${query.slice(0, 60)}`); };
          return { run: boom, first: boom, all: boom };
        }
        const stmt = sqlite.prepare(query);
        return {
          async run() {
            const info = stmt.run(...params);
            return { success: true, meta: { changes: info.changes } };
          },
          async first<T>() {
            return (stmt.reader ? (stmt.get(...params) as T) : null) ?? null;
          },
          async all<T>() {
            return { results: stmt.all(...params) as T[], success: true, meta: {} };
          },
        };
      };
      return {
        bind: (...params: unknown[]) => build(...params),
        run: () => build().run(),
        first: <T>() => build().first<T>(),
        all: <T>() => build().all<T>(),
        sql: query,
      };
    },
    batch: async (stmts: unknown[]) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const out: unknown[] = [];
        for (const stmt of stmts as Array<{ run: () => Promise<unknown> }>) out.push(await stmt.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let currentDb: D1Database;

function setupApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.env = { DB: currentDb, API_KEY: 'env-key-unused', WORKER_URL: 'https://worker.test' } as never;
    await next();
  });
  app.use('*', authMiddleware as never);
  app.route('/', friendAttributes);
  return app;
}

function authed(path: string, init: RequestInit = {}, key: string | null = OWNER_KEY) {
  const headers = new Headers(init.headers);
  if (key) headers.set('Authorization', `Bearer ${key}`);
  return { path, init: { ...init, headers } };
}
const jpost = (path: string, body: unknown, key = OWNER_KEY, idempotencyKey?: string) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return authed(path, { method: 'POST', headers, body: JSON.stringify(body) }, key);
};
const jpatch = (path: string, body: unknown, key = OWNER_KEY) =>
  authed(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, key);
const jdelete = (path: string, body: unknown, key = OWNER_KEY) =>
  authed(path, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, key);

const A = '?lineAccountId=acc-1';
const RULE = { name: '担当が決まったら', event: 'staff_assigned', condition: null, priority: 0, manualProtectionMinutes: 0, isActive: true };

const ruleStatus = (id: string) =>
  (sqlite.prepare(`SELECT status AS s FROM automation_definitions WHERE id = ?`).get(id) as { s: string } | undefined)?.s;
const ruleCount = () =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM automation_definitions WHERE status != 'archived'`).get() as { n: number }).n;

async function createRule(app: Hono, key: string) {
  const res = await app.request(...Object.values(
    jpost(`/api/support-marks/mk-own/automation-rules${A}`, RULE, OWNER_KEY, key),
  ) as [string, RequestInit]);
  const body = await res.json() as { data?: { id?: string; version?: number } };
  return { status: res.status, id: body.data?.id ?? '', version: body.data?.version ?? 0 };
}

beforeEach(() => {
  sqlite = setupSqlite();
  currentDb = asD1(sqlite);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

// R541: 停止した対応マーク自動変更ルールが並行編集で再び有効になる。
// 版照合と保管後の読み直しで直し済み。最新では古い版の編集は止まるため再現しない。
describe('R541 停止後の古い版の編集は有効に戻さない', () => {
  it('停止（保管）後の古い版の編集は404で、停止のまま残る', async () => {
    const app = setupApp();
    const created = await createRule(app, 'r541-key-1');
    expect(created.status).toBe(201);
    const stopped = await app.request(...Object.values(
      jdelete(`/api/support-mark-rules/${created.id}${A}`, { expectedVersion: 1 }),
    ) as [string, RequestInit]);
    expect(stopped.status).toBe(200);
    expect(ruleStatus(created.id)).toBe('archived');
    // 停止前に読んだ版での編集は通さず、停止のまま。
    const stale = await app.request(...Object.values(
      jpatch(`/api/support-mark-rules/${created.id}${A}`, { ...RULE, expectedVersion: 1 }),
    ) as [string, RequestInit]);
    expect(stale.status).toBe(404);
    expect(ruleStatus(created.id)).toBe('archived');
    expect(ruleCount()).toBe(0);
  });

  it('無効化後の古い版の編集は409で、有効に戻らない', async () => {
    const app = setupApp();
    const created = await createRule(app, 'r541-key-2');
    const stopEdit = await app.request(...Object.values(
      jpatch(`/api/support-mark-rules/${created.id}${A}`, { ...RULE, isActive: false, expectedVersion: 1 }),
    ) as [string, RequestInit]);
    expect(stopEdit.status).toBe(200);
    expect(ruleStatus(created.id)).toBe('stopped');
    // 無効化前に読んだ版での編集は競合で止める。
    const stale = await app.request(...Object.values(
      jpatch(`/api/support-mark-rules/${created.id}${A}`, { ...RULE, expectedVersion: 1 }),
    ) as [string, RequestInit]);
    expect(stale.status).toBe(409);
    expect(ruleStatus(created.id)).toBe('stopped');
  });
});

// R542: 既定マーク変更の途中失敗で既定が0件になる。
// D031 で順序を変え済み（新しい既定を先に確定し、古い既定は後に外す）。
// 最新では既定が0件にならないため再現しない。
describe('R542 既定の付け替え失敗でも既定は0件にならない', () => {
  it('古い既定を外す段階の失敗でも旧既定が残り、成功時は1件だけ残る', async () => {
    currentDb = asD1(sqlite, ['SET is_default = 0']);
    const res = await setupApp().request(...Object.values(
      jpatch(`/api/support-marks/mk-own${A}`, { isDefault: true }),
    ) as [string, RequestInit]);
    expect(res.status).toBe(500);
    // 旧既定は残る（0件にならない）。
    const defaults = sqlite.prepare(`SELECT id FROM support_marks WHERE is_default = 1 AND archived_at IS NULL`).all() as Array<{ id: string }>;
    expect(defaults.map((row) => row.id)).toContain('mk-def');
    // 成功時は1件だけ残る。
    currentDb = asD1(sqlite);
    const retry = await setupApp().request(...Object.values(
      jpatch(`/api/support-marks/mk-own${A}`, { isDefault: true }),
    ) as [string, RequestInit]);
    expect(retry.status).toBe(200);
    const after = sqlite.prepare(`SELECT id FROM support_marks WHERE is_default = 1 AND archived_at IS NULL`).all() as Array<{ id: string }>;
    expect(after.map((row) => row.id)).toEqual(['mk-own']);
  });
});

// R543: 自動変更ルールを同一入力で再送すると二つ登録される。
// D034 で要求キーが必須になり、同じキー・同じ内容は保存済みを返す。
// 最新では二重に残らないため再現しない。
describe('R543 同一入力の再送でルールは二重に残らない', () => {
  it('要求キーが無い作成は400で、同じキー・同じ内容の再送は1件のまま', async () => {
    const app = setupApp();
    const noKey = await app.request(...Object.values(
      jpost(`/api/support-marks/mk-own/automation-rules${A}`, RULE),
    ) as [string, RequestInit]);
    expect(noKey.status).toBe(400);
    expect(ruleCount()).toBe(0);
    // 応答を失った想定で同じキー・同じ内容を送り直す。
    const r1 = await app.request(...Object.values(
      jpost(`/api/support-marks/mk-own/automation-rules${A}`, RULE, OWNER_KEY, 'r543-key'),
    ) as [string, RequestInit]);
    const r2 = await app.request(...Object.values(
      jpost(`/api/support-marks/mk-own/automation-rules${A}`, RULE, OWNER_KEY, 'r543-key'),
    ) as [string, RequestInit]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    const b1 = await r1.json() as { data?: { id?: string } };
    const b2 = await r2.json() as { data?: { id?: string } };
    expect(b2.data?.id).toBe(b1.data?.id);
    expect(ruleCount()).toBe(1);
  });
});

// R544: 対応マーク編集APIが空名と範囲外の並び順を保存する。
// D032 で作成と同じ検査を編集にも入れ済み。最新では400で止めるため再現しない。
describe('R544 編集の空名・範囲外の順序は400で止める', () => {
  it('空名・-1・10001は400、境界の0と10000は通す', async () => {
    const app = setupApp();
    const empty = await app.request(...Object.values(jpatch(`/api/support-marks/mk-own${A}`, { name: '' })) as [string, RequestInit]);
    const minus = await app.request(...Object.values(jpatch(`/api/support-marks/mk-own${A}`, { displayOrder: -1 })) as [string, RequestInit]);
    const huge = await app.request(...Object.values(jpatch(`/api/support-marks/mk-own${A}`, { displayOrder: 10001 })) as [string, RequestInit]);
    expect([empty.status, minus.status, huge.status]).toEqual([400, 400, 400]);
    expect(sqlite.prepare(`SELECT name AS n, display_order AS o FROM support_marks WHERE id = 'mk-own'`).get())
      .toEqual({ n: '独自マーク', o: 0 });
    const zero = await app.request(...Object.values(jpatch(`/api/support-marks/mk-own${A}`, { displayOrder: 0 })) as [string, RequestInit]);
    const max = await app.request(...Object.values(jpatch(`/api/support-marks/mk-own${A}`, { displayOrder: 10000 })) as [string, RequestInit]);
    expect([zero.status, max.status]).toEqual([200, 200]);
    expect(sqlite.prepare(`SELECT display_order AS o FROM support_marks WHERE id = 'mk-own'`).get())
      .toEqual({ o: 10000 });
  });
});
