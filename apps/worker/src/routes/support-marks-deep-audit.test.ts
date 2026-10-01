import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMiddleware } from '../middleware/auth.js';
import { friendAttributes } from './friend-attributes.js';

/*
 * D028〜D035（対応マークの作成・編集・自動変更ルール）の深い再調査の回帰試験。
 *
 * Devin の監査（round-D60/D61）は古いコード（#1029 時点）で行われ、
 * その後の #1032（R510〜R519：要求キー・版照合）が一部を解消した。
 * 各指摘が最新のコードで起きるかを、実ルート＋実認証＋メモリSQLite＋
 * 失敗注入（SQL片に引っかけてわざと落とす）で確かめる。
 */

const BOOTSTRAP_SQL = readFileSync(
  join(import.meta.dirname, '../../../../packages/db/bootstrap.sql'),
  'utf8',
);
const TENANT = '00000000-0000-4000-8000-000000000001';

const OWNER_KEY = 'deep-owner';
const STAFF_KEY = 'deep-staff';
const VIEWER_KEY = 'deep-viewer';
const SCOPED_KEY = 'deep-scoped';

function setupSqlite() {
  const sqlite = new Database(':memory:');
  sqlite.exec(BOOTSTRAP_SQL);
  sqlite.prepare(
    `INSERT INTO line_accounts (id, name, channel_id, channel_access_token, channel_secret)
     VALUES ('acc-1', 'アカウント1', 'ch-1', 'token', 'secret'),
            ('acc-other', '別アカウント', 'ch-2', 'token2', 'secret2')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO staff_members
       (id, name, email, role, access_level, api_key, is_active, invite_status, tenant_id, permission_keys, view_permission_keys, account_scope)
     VALUES
       ('st-owner', 'オーナー', 'o@example.com', 'owner', 'full', ?, 1, 'active', ?, '[]', '[]', 'all'),
       ('st-staff', 'スタッフ', 's@example.com', 'staff', 'full', ?, 1, 'active', ?, '["/tags"]', '["/tags"]', 'all'),
       ('st-viewer', '閲覧のみ', 'v@example.com', 'staff', 'read_only', ?, 1, 'active', ?, '[]', '["/tags"]', 'all'),
       ('st-scoped', '限定管理者', 'sc@example.com', 'admin', 'full', ?, 1, 'active', ?, '[]', '[]', 'accounts')`,
  ).run(OWNER_KEY, TENANT, STAFF_KEY, TENANT, VIEWER_KEY, TENANT, SCOPED_KEY, TENANT);
  sqlite.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('st-scoped', 'acc-other', '2026-01-01T00:00:00.000')`,
  ).run();
  // acc-1 専用 2件（1件は既定）・acc-other 1件・共有（scope行なし）2件
  const ins = sqlite.prepare(
    `INSERT INTO support_marks (id, name, color, is_default, auto_on_inbound, display_order, created_at, version, updated_at)
     VALUES (?, ?, '#EF4B55', ?, 0, ?, '2026-01-01T00:00:00.000', 1, '2026-01-01T00:00:00.000')`,
  );
  ins.run('mk-own', '独自マーク', 0, 0);
  ins.run('mk-def', '既定マーク', 1, 1);
  ins.run('mk-oth', '他アカマーク', 0, 0);
  ins.run('mk-inh', '共有マーク', 0, 2);
  ins.run('mk-inh2', '共有マーク使用中', 0, 3);
  const insScope = sqlite.prepare(
    `INSERT INTO support_mark_scopes (mark_id, tenant_id, line_account_id, created_at)
     VALUES (?, ?, ?, '2026-01-01T00:00:00.000')`,
  );
  insScope.run('mk-own', TENANT, 'acc-1');
  insScope.run('mk-def', TENANT, 'acc-1');
  insScope.run('mk-oth', TENANT, 'acc-other');
  // mk-inh は acc-1 の友だちに付いている共有マーク、mk-inh2 は配信で参照中
  sqlite.prepare(
    `INSERT INTO friends (id, line_user_id, line_account_id, is_following, support_mark_id)
     VALUES ('f-1', 'U-f1', 'acc-1', 1, 'mk-inh')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id, segment_conditions)
     VALUES ('bc-1', '配信', 'text', 'こんにちは', 'segment', 'draft', 'acc-1',
             '{"all":[{"kind":"support_mark","value":"mk-inh2"}]}')`,
  ).run();
  return sqlite;
}

/** 実D1の batch と同じく原子（失敗したら全部戻る）。failOn のSQL片に当たったら落とす。 */
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
        first: <T,>() => build().first<T>(),
        all: <T,>() => build().all<T>(),
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

const A = '?lineAccountId=acc-1';
const BODY = { name: '要確認', color: '#EF4B55', displayOrder: 0, isDefault: false, autoOnInbound: false };
const RULE = { name: '担当が決まったら', event: 'staff_assigned', condition: null, priority: 0, manualProtectionMinutes: 0, isActive: true };

const markCount = () =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM support_marks WHERE archived_at IS NULL`).get() as { n: number }).n;
const markRow = (id: string) =>
  sqlite.prepare(`SELECT * FROM support_marks WHERE id = ?`).get(id) as Record<string, unknown> | undefined;

beforeEach(() => {
  sqlite = setupSqlite();
  currentDb = asD1(sqlite);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

// D029: 作成の二重実行。#1032（R512）で要求キーが必須になり、
// キー無しは作らず400・同じキー＋同じ内容は保存済みを返す・違う内容は409で止める。
describe('D029 対応マーク作成の冪等化', () => {
  it('要求キーが無い作成は400で、1行も作らない', async () => {
    const app = setupApp();
    const res = await app.request(...Object.values(jpost(`/api/support-marks${A}`, BODY)) as [string, RequestInit]);
    expect(res.status).toBe(400);
    expect(markCount()).toBe(5);
  });

  it('同じキー・同じ内容の再送は200で保存済みを返し、2行にならない', async () => {
    const app = setupApp();
    const r1 = await app.request(...Object.values(jpost(`/api/support-marks${A}`, BODY, OWNER_KEY, 'd-key-1')) as [string, RequestInit]);
    const r2 = await app.request(...Object.values(jpost(`/api/support-marks${A}`, BODY, OWNER_KEY, 'd-key-1')) as [string, RequestInit]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    const b1 = await r1.json() as { data?: { id?: string } };
    const b2 = await r2.json() as { data?: { id?: string } };
    expect(b2.data?.id).toBe(b1.data?.id);
    expect(markCount()).toBe(6);
  });

  it('同じキーに違う内容は409で作らない', async () => {
    const app = setupApp();
    const r1 = await app.request(...Object.values(jpost(`/api/support-marks${A}`, BODY, OWNER_KEY, 'd-key-2')) as [string, RequestInit]);
    const r2 = await app.request(...Object.values(
      jpost(`/api/support-marks${A}`, { ...BODY, name: '別名' }, OWNER_KEY, 'd-key-2'),
    ) as [string, RequestInit]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(409);
    expect(markCount()).toBe(6);
  });
});

// D028: 作成の確定後に読み戻しだけ失敗しても、作ったものを成功として返す。
// 500で「失敗」と見せると利用者が送り直し、同名マークが増える。
describe('D028 対応マーク作成の読み戻し失敗', () => {
  it('ルール一覧の読み戻しに失敗しても201で、再送で増えない', async () => {
    currentDb = asD1(sqlite, ['FROM automation_definitions d']);
    const app = setupApp();
    const res = await app.request(...Object.values(
      jpost(`/api/support-marks${A}`, { ...BODY, automationRules: [RULE] }, OWNER_KEY, 'd-key-3'),
    ) as [string, RequestInit]);
    expect(res.status).toBe(201);
    expect(markCount()).toBe(6);
    // 応答を見失った想定で同じキーで送り直す → 保存済みが返る（200）だけで増えない
    currentDb = asD1(sqlite);
    const retry = await setupApp().request(...Object.values(
      jpost(`/api/support-marks${A}`, { ...BODY, automationRules: [RULE] }, OWNER_KEY, 'd-key-3'),
    ) as [string, RequestInit]);
    expect(retry.status).toBe(200);
    expect(markCount()).toBe(6);
  });
});

// D030: マーク名の長さ上限。空名・色・順序は400で弾くのに、長い名前だけ通っていた。
describe('D030 対応マーク名の長さ上限', () => {
  it('5000文字の名前は400で作らない', async () => {
    const app = setupApp();
    const res = await app.request(...Object.values(
      jpost(`/api/support-marks${A}`, { ...BODY, name: 'x'.repeat(5000) }, OWNER_KEY, 'd-key-4'),
    ) as [string, RequestInit]);
    expect(res.status).toBe(400);
    expect(markCount()).toBe(5);
  });

  it('100文字は作れて101文字は400', async () => {
    const app = setupApp();
    const ok = await app.request(...Object.values(
      jpost(`/api/support-marks${A}`, { ...BODY, name: 'x'.repeat(100) }, OWNER_KEY, 'd-key-5'),
    ) as [string, RequestInit]);
    const ng = await app.request(...Object.values(
      jpost(`/api/support-marks${A}`, { ...BODY, name: 'x'.repeat(101) }, OWNER_KEY, 'd-key-6'),
    ) as [string, RequestInit]);
    expect(ok.status).toBe(201);
    expect(ng.status).toBe(400);
  });
});

// D031: 本体編集の版照合。#1032（R513）で expectedVersion を送れば409で止まる。
// 送った版が古いのに黙って上書きしないことを確かめる。
describe('D031 対応マーク編集の版照合', () => {
  it('古い版の保存は409で止めて相手の変更を残し、最新の内容を返す', async () => {
    const app = setupApp();
    const r1 = await app.request(...Object.values(
      jpatch(`/api/support-marks/mk-own${A}`, { name: 'A案' }),
    ) as [string, RequestInit]);
    expect(r1.status).toBe(200);
    const r2 = await app.request(...Object.values(
      jpatch(`/api/support-marks/mk-own${A}`, { name: 'B案', expectedVersion: 1 }),
    ) as [string, RequestInit]);
    expect(r2.status).toBe(409);
    const body = await r2.json() as { code?: string; data?: { latest?: { name?: string; version?: number } } };
    expect(body.code).toBe('SUPPORT_MARK_VERSION_CONFLICT');
    expect(body.data?.latest?.name).toBe('A案');
    expect(markRow('mk-own')?.name).toBe('A案');
  });

  it('正しい版なら200で版が上がる', async () => {
    const app = setupApp();
    await app.request(...Object.values(
      jpatch(`/api/support-marks/mk-own${A}`, { name: 'A案' }),
    ) as [string, RequestInit]);
    const res = await app.request(...Object.values(
      jpatch(`/api/support-marks/mk-own${A}`, { name: 'B案', expectedVersion: 2 }),
    ) as [string, RequestInit]);
    expect(res.status).toBe(200);
    expect(markRow('mk-own')?.name).toBe('B案');
    expect(markRow('mk-own')?.version).toBe(3);
  });
});

// D032: 編集の入力検査を作成とそろえる。空名・範囲外の順序を通さず、型違いは500にしない。
describe('D032 対応マーク編集の入力検査', () => {
  it('空名・範囲外の順序・型違いは400で、書き換えない', async () => {
    const app = setupApp();
    const empty = await app.request(...Object.values(
      jpatch(`/api/support-marks/mk-own${A}`, { name: '   ' }),
    ) as [string, RequestInit]);
    const long = await app.request(...Object.values(
      jpatch(`/api/support-marks/mk-own${A}`, { name: 'x'.repeat(5000) }),
    ) as [string, RequestInit]);
    const minus = await app.request(...Object.values(
      jpatch(`/api/support-marks/mk-own${A}`, { displayOrder: -5 }),
    ) as [string, RequestInit]);
    const huge = await app.request(...Object.values(
      jpatch(`/api/support-marks/mk-own${A}`, { displayOrder: 99999 }),
    ) as [string, RequestInit]);
    const text = await app.request(...Object.values(
      jpatch(`/api/support-marks/mk-own${A}`, { displayOrder: 'abc' }),
    ) as [string, RequestInit]);
    const float = await app.request(...Object.values(
      jpatch(`/api/support-marks/mk-own${A}`, { displayOrder: 1.5 }),
    ) as [string, RequestInit]);
    expect([empty.status, long.status, minus.status, huge.status, text.status, float.status])
      .toEqual([400, 400, 400, 400, 400, 400]);
    expect(markRow('mk-own')?.name).toBe('独自マーク');
    expect(markRow('mk-own')?.display_order).toBe(0);
  });

  it('正しい名前と順序は200で変わる', async () => {
    const app = setupApp();
    const res = await app.request(...Object.values(
      jpatch(`/api/support-marks/mk-own${A}`, { name: '対応中', displayOrder: 5 }),
    ) as [string, RequestInit]);
    expect(res.status).toBe(200);
    expect(markRow('mk-own')?.name).toBe('対応中');
    expect(markRow('mk-own')?.display_order).toBe(5);
  });
});

// D033: 共有マーク編集の「複製→友だち付け替え」を1つの取引にまとめる。
// 付け替えで失敗したら複製も残さず、送り直しで増やさない。
describe('D033 共有マーク編集の複製と付け替え', () => {
  it('付け替えの失敗では500だが複製を残さず、送り直しで1件だけ増える', async () => {
    currentDb = asD1(sqlite, ['UPDATE friends SET support_mark_id']);
    const res = await setupApp().request(...Object.values(
      jpatch(`/api/support-marks/mk-inh${A}`, { name: '複製だけ残る' }),
    ) as [string, RequestInit]);
    expect(res.status).toBe(500);
    expect(markCount()).toBe(5);
    expect(sqlite.prepare(`SELECT support_mark_id AS m FROM friends WHERE id = 'f-1'`).get())
      .toEqual({ m: 'mk-inh' });
    currentDb = asD1(sqlite);
    const retry = await setupApp().request(...Object.values(
      jpatch(`/api/support-marks/mk-inh${A}`, { name: '店舗版' }),
    ) as [string, RequestInit]);
    expect(retry.status).toBe(200);
    expect(markCount()).toBe(6);
    const body = await retry.json() as { data?: { id?: string } };
    expect(sqlite.prepare(`SELECT support_mark_id AS m FROM friends WHERE id = 'f-1'`).get())
      .toEqual({ m: body.data?.id });
    expect(markRow('mk-inh')?.name).toBe('共有マーク');
  });
});

// D034: 自動変更ルール作成の二重実行。対応マーク作成と同じく要求キーを必須にし、
// 同じキー＋同じ内容は保存済みを返し、違う内容は409で止める。
describe('D034 自動変更ルール作成の冪等化', () => {
  it('要求キーが無い作成は400で、1件も作らない', async () => {
    const app = setupApp();
    const res = await app.request(...Object.values(
      jpost(`/api/support-marks/mk-own/automation-rules${A}`, RULE),
    ) as [string, RequestInit]);
    expect(res.status).toBe(400);
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM automation_definitions`).get() as { n: number }).n).toBe(0);
  });

  it('同じキー・同じ内容の再送は200で保存済みを返し、2件にならない', async () => {
    const app = setupApp();
    const headers = { 'Idempotency-Key': 'rule-key-1' };
    const r1 = await app.request(...Object.values(
      authed(`/api/support-marks/mk-own/automation-rules${A}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(RULE) }),
    ) as [string, RequestInit]);
    const r2 = await app.request(...Object.values(
      authed(`/api/support-marks/mk-own/automation-rules${A}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(RULE) }),
    ) as [string, RequestInit]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    const b1 = await r1.json() as { data?: { id?: string } };
    const b2 = await r2.json() as { data?: { id?: string } };
    expect(b2.data?.id).toBe(b1.data?.id);
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM automation_definitions`).get() as { n: number }).n).toBe(1);
  });

  it('同じキーに違う内容は409で作らない', async () => {
    const app = setupApp();
    const post = (body: unknown) => app.request(...Object.values(
      authed(`/api/support-marks/mk-own/automation-rules${A}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'rule-key-2' }, body: JSON.stringify(body) }),
    ) as [string, RequestInit]);
    const r1 = await post(RULE);
    const r2 = await post({ ...RULE, name: '別のルール' });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(409);
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM automation_definitions`).get() as { n: number }).n).toBe(1);
  });
});

// D035: ルール条件の形の検査。{bogus:true} のような未知の形は「全員一致」として
// 動いてしまうため、作らせず422で止める。正しい形は通す。
describe('D035 自動変更ルール条件の形状検証', () => {
  const postRule = (app: Hono, condition: unknown, key: string) => app.request(...Object.values(
    authed(`/api/support-marks/mk-own/automation-rules${A}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ ...RULE, condition }) }),
  ) as [string, RequestInit]);

  it('未知の形の条件は422で作らない', async () => {
    const app = setupApp();
    const bogus = await postRule(app, { bogus: true }, 'cond-key-1');
    const text = await postRule(app, 'all', 'cond-key-2');
    const badOp = await postRule(app, { operator: 'XOR', rules: [] }, 'cond-key-3');
    expect([bogus.status, text.status, badOp.status]).toEqual([422, 422, 422]);
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM automation_definitions`).get() as { n: number }).n).toBe(0);
  });

  it('正しい形の条件は201で作れる', async () => {
    const app = setupApp();
    const res = await postRule(app, { operator: 'AND', rules: [{ type: 'is_following', value: true }] }, 'cond-key-4');
    expect(res.status).toBe(201);
    const empty = await postRule(app, {}, 'cond-key-5');
    expect(empty.status).toBe(201);
  });
});
