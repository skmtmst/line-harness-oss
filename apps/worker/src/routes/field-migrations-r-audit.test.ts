import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateFriendFieldValue } from '@line-crm/db';
import { authMiddleware } from '../middleware/auth.js';
import { friendFields } from './friend-fields.js';

/*
 * R545〜R549（情報欄の移行）の最新枝での照合。
 *
 * 監査は古いSHA（918b8cdb）で行われた。D036〜D038 で直ったものは
 * コードを変えず「最新では再現しない」ことをここで証拠立てる。
 * 残っていた R549（16進表記の数値解釈のずれ）だけ本体を直し、
 * その動きをこのファイルで守る。
 *
 * 実ルート＋実認証＋メモリSQLite＋失敗注入で確かめる。
 * c.executionCtx が無い試験環境では、実行はその場で同期的に走る。
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
  const insField = sqlite.prepare(
    `INSERT INTO friend_fields (id, folder_id, name, field_key, type, options_json, default_value,
       source, ec_field_path, ec_is_master, is_personal, is_starred, display_order,
       type_v6, created_at, updated_at, status, version)
     VALUES (?, NULL, ?, ?, ?, NULL, NULL, 'manual', NULL, 0, 0, 0, ?, ?, '2026-01-01T00:00:00.000', '2026-01-01T00:00:00.000', 'active', 1)`,
  );
  insField.run('ff-src', 'ペットの名前', 'pet_name', 'text', 0, 'text');
  insField.run('ff-dst', 'ペットの名前（新）', 'pet_name_v2', 'text', 1, 'text');
  insField.run('ff-num', '数値化する先', 'pet_age', 'number', 2, 'number');
  const insScope = sqlite.prepare(
    `INSERT INTO friend_field_scopes (field_id, tenant_id, line_account_id, created_at)
     VALUES (?, ?, ?, '2026-01-01T00:00:00.000')`,
  );
  insScope.run('ff-src', TENANT, 'acc-1');
  insScope.run('ff-dst', TENANT, 'acc-1');
  insScope.run('ff-num', TENANT, 'acc-1');
  sqlite.prepare(
    `INSERT INTO friends (id, line_user_id, line_account_id, is_following)
     VALUES ('f-1', 'U-f1', 'acc-1', 1), ('f-2', 'U-f2', 'acc-1', 1),
            ('f-3', 'U-f3', 'acc-1', 1), ('f-4', 'U-f4', 'acc-1', 1)`,
  ).run();
  const insVal = sqlite.prepare(
    `INSERT INTO friend_field_values (friend_id, field_id, value, value_text, updated_at)
     VALUES (?, 'ff-src', ?, ?, '2026-01-01T00:00:00.000')`,
  );
  insVal.run('f-1', 'ポチ', 'ポチ');
  insVal.run('f-2', '123', '123');
  insVal.run('f-3', '0x10', '0x10');
  insVal.run('f-4', '16', '16');
  // 「移行時に切り替え」と約束する使用先: 情報欄起点のリマインダ
  sqlite.prepare(
    `INSERT INTO reminders (id, name, is_active, line_account_id, trigger_type, trigger_field_id, delivery_mode)
     VALUES ('rem-1', '誕生日リマインダ', 1, 'acc-1', 'friend_field', 'ff-src', 'countdown')`,
  ).run();
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
const dstValue = (friendId: string, fieldId: string) =>
  (sqlite.prepare(`SELECT value AS v FROM friend_field_values WHERE friend_id = ? AND field_id = ?`).get(friendId, fieldId) as { v: string } | undefined)?.v;

type PreviewData = {
  previewToken?: string | null;
  runId?: string | null;
  summary?: { total: number; convertible: number; review: number; invalid: number };
  usageTargets?: Array<{ id: string; kind: string; switchable: boolean }>;
};

/** 事前確認をして token/runId/集計を返す */
async function preview(app: Hono, sourceId = 'ff-src', targetId: string) {
  const res = await app.request(...Object.values(
    jpost(`/api/friend-fields/${sourceId}/migration-preview${A}`, { targetFieldId: targetId }),
  ) as [string, RequestInit]);
  const body = await res.json() as { success: boolean; data?: PreviewData };
  return { status: res.status, ...(body.data ?? {}) };
}

async function execute(app: Hono, sourceId: string, token: string | null | undefined, key: string) {
  return app.request(...Object.values(
    jpost(`/api/friend-fields/${sourceId}/migrations${A}`, { previewToken: token }, OWNER_KEY, { 'Idempotency-Key': key }),
  ) as [string, RequestInit]);
}

beforeEach(() => {
  sqlite = setupSqlite();
  currentDb = asD1(sqlite);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

// R545: 移行の事前確認で行保存に失敗すると親の確認記録だけが残る。
// D038 で直し済み。最新では失敗時に run ごと片付けるため再現しない。
describe('R545 事前確認の失敗で親だけ残さない', () => {
  it('項目の書き込み失敗では500だがrunを残さない', async () => {
    currentDb = asD1(sqlite, ['INSERT INTO field_migration_items']);
    const res = await setupApp().request(...Object.values(
      jpost(`/api/friend-fields/ff-src/migration-preview${A}`, { targetFieldId: 'ff-dst' }),
    ) as [string, RequestInit]);
    expect(res.status).toBe(500);
    expect(runCount()).toBe(0);
  });
});

// R546: 項目移行後も切替対象リマインダーが元項目を参照する（P1）。
// D037 で直し済み。最新では全部移せたときに約束した使用先を切り替えるため再現しない。
describe('R546 移行後は約束したリマインダーが移行先を指す', () => {
  it('切替可能と示したリマインダー参照が新項目IDになる', async () => {
    const app = setupApp();
    const p = await preview(app, 'ff-src', 'ff-dst');
    expect(p.status).toBe(200);
    const reminder = (p.usageTargets ?? []).find((u) => u.id === 'rem-1');
    expect(reminder?.switchable).toBe(true);
    const res = await execute(setupApp(), 'ff-src', p.previewToken, 'r546-key');
    expect(res.status).toBe(202);
    expect(sqlite.prepare(`SELECT trigger_field_id AS f FROM reminders WHERE id = 'rem-1'`).get())
      .toEqual({ f: 'ff-dst' });
    expect(sqlite.prepare(`SELECT status AS s FROM friend_fields WHERE id = 'ff-src'`).get())
      .toEqual({ s: 'read_only' });
  });
});

// R547: 移行の最終集計失敗で値だけ移り処理記録は処理中のままになる（P1）。
// D036 で直し済み。最新では送り直しで続けられ、件数は表から数え直すため再現しない。
describe('R547 最終集計の失敗後は送り直しで実値と件数が一致する', () => {
  it('集計の失敗では値は移るが、送り直しで完了し件数が合う', async () => {
    const p = await preview(setupApp(), 'ff-src', 'ff-dst');
    currentDb = asD1(sqlite, ['processed_count']);
    const res = await execute(setupApp(), 'ff-src', p.previewToken, 'r547-key-1');
    expect(res.status).toBe(500);
    expect(dstValue('f-1', 'ff-dst')).toBe('ポチ');
    currentDb = asD1(sqlite);
    const retry = await execute(setupApp(), 'ff-src', p.previewToken, 'r547-key-2');
    expect(retry.status).toBe(202);
    const run = runRow(p.runId!);
    expect(run?.status).toBe('succeeded');
    // 実値と処理記録の件数が一致する（4人ぶん）。
    expect(run?.processed_count).toBe(4);
    expect(run?.succeeded_count).toBe(4);
    expect(dstValue('f-4', 'ff-dst')).toBe('16');
  });
});

// R549: 事前確認で数値扱いした16進表記を移行保存時に拒否する。
// 本体を直した。事前確認と保存で同じ物差しを使うため、件数は合う。
describe('R549 16進表記の数値解釈を事前確認と保存で揃える', () => {
  it('0x10は保存側でも事前確認側でも数値として通さない', () => {
    expect(validateFriendFieldValue({ type: 'number', options_json: null }, '0x10').ok).toBe(false);
    expect(validateFriendFieldValue({ type: 'number', options_json: null }, '1e5').ok).toBe(false);
    expect(validateFriendFieldValue({ type: 'number', options_json: null }, '16').ok).toBe(true);
  });

  it('数値への事前確認で0x10は「そのまま移せる」に入らない', async () => {
    const p = await preview(setupApp(), 'ff-src', 'ff-num');
    expect(p.status).toBe(200);
    // 123・16だけが移せる。0x10・ポチは人が確認する。
    expect(p.summary).toMatchObject({ total: 4, convertible: 2, review: 2 });
  });

  it('実行後も件数は合い、0x10の値は書かない', async () => {
    const app = setupApp();
    const p = await preview(app, 'ff-src', 'ff-num');
    const res = await execute(setupApp(), 'ff-src', p.previewToken, 'r549-key');
    expect(res.status).toBe(202);
    const run = runRow(p.runId!);
    // 要確認が残るため一部完了。成功2＋要確認2で合計4と一致する。
    expect(run?.status).toBe('partial');
    expect(Number(run?.succeeded_count)).toBe(2);
    expect(dstValue('f-4', 'ff-num')).toBe('16');
    expect(dstValue('f-3', 'ff-num')).toBeUndefined();
  });
});
