import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMiddleware } from '../middleware/auth.js';
import { friendFields } from './friend-fields.js';

/*
 * D036〜D038（友だち情報欄の移行）の深い再調査の回帰試験。
 *
 * 実ルート＋実認証＋メモリSQLite＋失敗注入で確かめる。
 * c.executionCtx が無い試験環境では、実行はその場で同期的に走る。
 */

const BOOTSTRAP_SQL = readFileSync(
  join(import.meta.dirname, '../../../../packages/db/bootstrap.sql'),
  'utf8',
);
const TENANT = '00000000-0000-4000-8000-000000000001';

const OWNER_KEY = 'mig-owner';
const STAFF_KEY = 'mig-staff';
const VIEWER_KEY = 'mig-viewer';
const SCOPED_KEY = 'mig-scoped';

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
  // 項目: 移行元(text)・移行先(text/number)、別アカ1件
  const insField = sqlite.prepare(
    `INSERT INTO friend_fields (id, folder_id, name, field_key, type, options_json, default_value,
       source, ec_field_path, ec_is_master, is_personal, is_starred, display_order,
       type_v6, created_at, updated_at, status, version)
     VALUES (?, NULL, ?, ?, ?, NULL, NULL, 'manual', NULL, 0, 0, 0, ?, ?, '2026-01-01T00:00:00.000', '2026-01-01T00:00:00.000', 'active', 1)`,
  );
  insField.run('ff-src', 'ペットの名前', 'pet_name', 'text', 0, 'text');
  insField.run('ff-dst', 'ペットの名前（新）', 'pet_name_v2', 'text', 1, 'text');
  insField.run('ff-num', '数値化する先', 'pet_age', 'number', 2, 'number');
  insField.run('ff-oth', '別アカ項目', 'other_key', 'text', 0, 'text');
  const insScope = sqlite.prepare(
    `INSERT INTO friend_field_scopes (field_id, tenant_id, line_account_id, created_at)
     VALUES (?, ?, ?, '2026-01-01T00:00:00.000')`,
  );
  insScope.run('ff-src', TENANT, 'acc-1');
  insScope.run('ff-dst', TENANT, 'acc-1');
  insScope.run('ff-num', TENANT, 'acc-1');
  insScope.run('ff-oth', TENANT, 'acc-other');
  // 友だち2人に移行元の値
  sqlite.prepare(
    `INSERT INTO friends (id, line_user_id, line_account_id, is_following)
     VALUES ('f-1', 'U-f1', 'acc-1', 1), ('f-2', 'U-f2', 'acc-1', 1)`,
  ).run();
  const insVal = sqlite.prepare(
    `INSERT INTO friend_field_values (friend_id, field_id, value, value_text, updated_at)
     VALUES (?, 'ff-src', ?, ?, '2026-01-01T00:00:00.000')`,
  );
  insVal.run('f-1', 'ポチ', 'ポチ');
  insVal.run('f-2', '123', '123');
  // 「移行時に切り替え」と約束する使用先: 情報欄起点のリマインダと、下書きの回答フォーム
  sqlite.prepare(
    `INSERT INTO reminders (id, name, is_active, line_account_id, trigger_type, trigger_field_id, delivery_mode)
     VALUES ('rem-1', '誕生日リマインダ', 1, 'acc-1', 'friend_field', 'ff-src', 'countdown')`,
  ).run();
  // 下書きだけが項目を指す形にする（公開後に下書きへ足した想定）。
  // 公開版にも残っていると「手動確認が必要」（switchable=false）が正しい。
  sqlite.prepare(
    `INSERT INTO forms (id, name, fields, status) VALUES ('fm-1', '里親アンケート', '[]', 'active')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO form_accounts (form_id, line_account_id) VALUES ('fm-1', 'acc-1')`,
  ).run();
  sqlite.prepare(`UPDATE forms SET fields = ? WHERE id = 'fm-1'`)
    .bind(JSON.stringify([{ name: 'ペットの名前', type: 'text', friendFieldId: 'ff-src' }])).run();
  // 公開版は変えない約束。フォーム作成時の自動版（form-version-v1-fm-1）が公開版になる。
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
  app.route('/', friendFields);
  return app;
}

function authed(path: string, init: RequestInit = {}, key: string | null = OWNER_KEY) {
  const headers = new Headers(init.headers);
  if (key) headers.set('Authorization', `Bearer ${key}`);
  return { path, init: { ...init, headers } };
}
const jpost = (path: string, body: unknown, key = OWNER_KEY, extra: Record<string, string> = {}) =>
  authed(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) }, key);

const A = '?lineAccountId=acc-1';

const runRow = (id: string) =>
  sqlite.prepare(`SELECT * FROM field_migration_runs WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
const runCount = () =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM field_migration_runs`).get() as { n: number }).n;
const dstValue = (friendId: string) =>
  (sqlite.prepare(`SELECT value AS v FROM friend_field_values WHERE friend_id = ? AND field_id = 'ff-dst'`).get(friendId) as { v: string } | undefined)?.v;

/** 事前確認をして token/runId を返す */
async function preview(app: Hono, sourceId = 'ff-src', targetId = 'ff-dst') {
  const res = await app.request(...Object.values(
    jpost(`/api/friend-fields/${sourceId}/migration-preview${A}`, { targetFieldId: targetId }),
  ) as [string, RequestInit]);
  const body = await res.json() as { success: boolean; data?: { previewToken?: string | null; runId?: string | null; usageTargets?: Array<{ id: string; kind: string; switchable: boolean }> } };
  return { status: res.status, token: body.data?.previewToken ?? null, runId: body.data?.runId ?? null, usage: body.data?.usageTargets ?? [] };
}

beforeEach(() => {
  sqlite = setupSqlite();
  currentDb = asD1(sqlite);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

// D038: 事前確認の途中で項目の書き込みに失敗したら、run も残さない。
// status=previewed の run だけが残ると、誰も使わない記録がたまる。
describe('D038 移行の事前確認の孤児run', () => {
  it('項目の書き込み失敗では500だがrunを残さない', async () => {
    currentDb = asD1(sqlite, ['INSERT INTO field_migration_items']);
    const res = await setupApp().request(...Object.values(
      jpost(`/api/friend-fields/ff-src/migration-preview${A}`, { targetFieldId: 'ff-dst' }),
    ) as [string, RequestInit]);
    expect(res.status).toBe(500);
    expect(runCount()).toBe(0);
  });

  it('正常な事前確認はrunと項目を残す', async () => {
    const app = setupApp();
    const p = await preview(app);
    expect(p.status).toBe(200);
    expect(p.token).toBeTruthy();
    expect(runRow(p.runId!)?.status).toBe('previewed');
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM field_migration_items WHERE run_id = ?`).get(p.runId!) as { n: number }).n).toBe(2);
  });
});

// D036: 本移行の完了記録が別取引で落ちても、半端な「実行中」で固めない。
// 値は移っているのに再実行が409で断られる状態にしない。止まった分は続けられる。
describe('D036 本移行の完了記録の失敗と再開', () => {
  it('完了記録の失敗では値は移るが、送り直しで最後まで終わる', async () => {
    const app0 = setupApp();
    const p = await preview(app0);
    currentDb = asD1(sqlite, ['processed_count']);
    const app = setupApp();
    const res = await app.request(...Object.values(
      jpost(`/api/friend-fields/ff-src/migrations${A}`, { previewToken: p.token }, OWNER_KEY, { 'Idempotency-Key': 'mig-key-1' }),
    ) as [string, RequestInit]);
    expect(res.status).toBe(500);
    // 値は移っている
    expect(dstValue('f-1')).toBe('ポチ');
    // 送り直し（別の要求キー）で続けられ、409で閉じない
    currentDb = asD1(sqlite);
    const retry = await setupApp().request(...Object.values(
      jpost(`/api/friend-fields/ff-src/migrations${A}`, { previewToken: p.token }, OWNER_KEY, { 'Idempotency-Key': 'mig-key-2' }),
    ) as [string, RequestInit]);
    expect(retry.status).toBe(202);
    const run = runRow(p.runId!);
    expect(run?.status).toBe('succeeded');
    expect(dstValue('f-1')).toBe('ポチ');
    expect(dstValue('f-2')).toBe('123');
    expect(sqlite.prepare(`SELECT status AS s FROM friend_fields WHERE id = 'ff-src'`).get()).toEqual({ s: 'read_only' });
  });

  it('行の書き込み失敗ではその行だけ失敗に倒し、元項目は有効のまま残す', async () => {
    const app0 = setupApp();
    const p = await preview(app0);
    currentDb = asD1(sqlite, ['INSERT INTO friend_field_values']);
    const res = await setupApp().request(...Object.values(
      jpost(`/api/friend-fields/ff-src/migrations${A}`, { previewToken: p.token }, OWNER_KEY, { 'Idempotency-Key': 'mig-key-3' }),
    ) as [string, RequestInit]);
    expect(res.status).toBe(202);
    expect(runRow(p.runId!)?.status).toBe('partial');
    expect(sqlite.prepare(`SELECT status AS s FROM friend_fields WHERE id = 'ff-src'`).get()).toEqual({ s: 'active' });
    expect(dstValue('f-1')).toBeUndefined();
  });
});

// D037: 事前確認で「移行時に切り替え」と出した使用先は、実行で本当に切り替える。
// リマインダと下書きフォームは移行先を指し、公開版は変えない。
describe('D037 移行時の使用先の切り替え', () => {
  it('実行後はリマインダと下書きが移行先を指し、公開版は元のまま', async () => {
    const app = setupApp();
    const p = await preview(app);
    const promised = p.usage.filter((u) => u.switchable).map((u) => u.id);
    expect(promised).toContain('rem-1');
    expect(promised).toContain('fm-1');
    const publishedBefore = (sqlite.prepare(`SELECT fields AS f FROM form_versions WHERE id = 'form-version-v1-fm-1'`).get() as { f: string }).f;
    const exec = await app.request(...Object.values(
      jpost(`/api/friend-fields/ff-src/migrations${A}`, { previewToken: p.token }, OWNER_KEY, { 'Idempotency-Key': 'mig-key-4' }),
    ) as [string, RequestInit]);
    expect(exec.status).toBe(202);
    expect(runRow(p.runId!)?.status).toBe('succeeded');
    // リマインダは移行先を見る
    expect(sqlite.prepare(`SELECT trigger_field_id AS f FROM reminders WHERE id = 'rem-1'`).get())
      .toEqual({ f: 'ff-dst' });
    // 下書きフォームは移行先を見る
    const draft = JSON.parse((sqlite.prepare(`SELECT fields AS f FROM forms WHERE id = 'fm-1'`).get() as { f: string }).f) as Array<{ friendFieldId?: string }>;
    expect(draft.map((field) => field.friendFieldId)).toEqual(['ff-dst']);
    // 公開版は変えない
    expect((sqlite.prepare(`SELECT fields AS f FROM form_versions WHERE id = 'form-version-v1-fm-1'`).get() as { f: string }).f)
      .toBe(publishedBefore);
  });
});
