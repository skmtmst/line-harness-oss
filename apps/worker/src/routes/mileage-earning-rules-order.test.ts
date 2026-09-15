/*
 * N-243 (#817): 「たまる決めごと」の並び順保存を部分適用しない。
 *
 * 実SQLite（better-sqlite3 + bootstrap.sql）に実物の scoring ルートを
 * 当て、認証も実物（Bearer APIキー→staff→権限・account境界）で通す。
 *
 * 対照: 変更のあった決めごとへ1件ずつ PATCH /earning-rules/:id/draft を
 * 投げる従来方式は、途中の版競合・通信断で一部だけ反映され得る。
 * 直し: PUT /api/mileage/earning-rules-order が全順序を1トランザクションで
 * 保存し、アカウントの一覧と一致しない並びはまるごと拒否する。
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';

function asD1(sqlite: Database.Database): D1Database {
  const wrap = (sql: string, params: unknown[]) => ({
    first: async <T>() => (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>() => ({ success: true, results: sqlite.prepare(sql).all(...params) as T[], meta: {} }),
    run: async <T>() => {
      const info = sqlite.prepare(sql).run(...params);
      return { success: true, results: [], meta: { changes: info.changes } } as T;
    },
    raw: async () => [],
  });
  return {
    prepare: (sql: string) => {
      const bound = (params: unknown[]): D1PreparedStatement => ({
        bind: (...next: unknown[]) => bound(next),
        ...wrap(sql, params),
      }) as unknown as D1PreparedStatement;
      return bound([]);
    },
    async batch<T>(statements: D1PreparedStatement[]) {
      const results = [];
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
      return results as T;
    },
  } as unknown as D1Database;
}

const ACC_A = 'acc-a';
const ACC_B = 'acc-b';
const KEY_OWNER = 'key-owner-aaa';
const KEY_A = 'key-staff-a';
const KEY_STAFF = 'key-staff-role';

function seed(sqlite: Database.Database) {
  sqlite.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  for (const id of [ACC_A, ACC_B]) {
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 'tenant-1')`,
    ).run(id, `channel-${id}`, id);
  }
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', 'オーナー', 'owner', ?, 'tenant-1', 'all')`,
  ).run(KEY_OWNER);
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('staff-a', '担当A', 'admin', ?, 'tenant-1', 'accounts')`,
  ).run(KEY_A);
  sqlite.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('staff-a', ?, '2026-09-01T00:00:00.000Z')`,
  ).run(ACC_A);
  // 並び順保存は owner/admin だけ。staff は閲覧まで。
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('staff-role', '閲覧担当', 'staff', ?, 'tenant-1', 'all')`,
  ).run(KEY_STAFF);
}

let sqlite: Database.Database;
let db: D1Database;
let scoringRoute: Awaited<typeof import('./scoring.js')>['scoring'];

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', scoringRoute);
  return instance;
}

function call(method: string, path: string, body: unknown, apiKey?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const env = { DB: db } as unknown as Env['Bindings'];
  return app().request(path, { method, headers, body: JSON.stringify(body) }, env);
}

const putOrder = (accountId: string, ids: unknown, apiKey?: string) =>
  call('PUT', '/api/mileage/earning-rules-order', { accountId, ids }, apiKey);

const patchDraft = (ruleId: string, accountId: string, expectedVersion: number | null, sortOrder: number, name: string) =>
  call('PATCH', `/api/mileage/earning-rules/${ruleId}/draft`, {
    accountId,
    expectedVersion,
    draft: {
      name,
      eventType: 'message_received',
      amount: 10,
      initialStatus: 'available',
      sortOrder,
    },
  }, KEY_OWNER);

function draftRow(ruleId: string): { version: number; sort_order: number } {
  const row = sqlite.prepare(
    `SELECT version, json_extract(draft_json, '$.sortOrder') AS sort_order
       FROM mileage_earning_rule_drafts WHERE rule_id = ?`,
  ).get(ruleId) as { version: number; sort_order: number } | undefined;
  if (!row) throw new Error(`draft missing: ${ruleId}`);
  return row;
}

/** 実routeで「決めごと＋下書き」を1件作る。下書きの版は1。 */
async function makeRule(accountId: string, name: string, sortOrder: number): Promise<string> {
  const created = await call('POST', '/api/mileage/rules', {
    name, eventType: 'message_received', amount: 10, lineAccountId: accountId,
  }, KEY_OWNER);
  expect(created.status).toBe(201);
  const { data } = (await created.json()) as { data: { id: string } };
  const drafted = await patchDraft(data.id, accountId, null, sortOrder, name);
  expect(drafted.status).toBe(200);
  return data.id;
}

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
  sqlite.pragma('foreign_keys = OFF');
  seed(sqlite);
  db = asD1(sqlite);
  ({ scoring: scoringRoute } = await import('./scoring.js'));
});

describe('決めごと並び順の部分適用(N-243)', () => {
  test('対照: 1件ずつのPATCHは途中の版競合で一部だけ反映される', async () => {
    const ruleA = await makeRule(ACC_A, '決めごとA', 0);
    const ruleB = await makeRule(ACC_A, '決めごとB', 1);

    // 別タブがBの下書きを先に保存し、版が 1→2 へ進んだ想定。
    const bump = await patchDraft(ruleB, ACC_A, 1, 1, '決めごとB');
    expect(bump.status).toBe(200);

    // 従来方式: AとBを入れ替える保存を1件ずつ投げる。Bだけ競合で落ちる。
    const swappedA = await patchDraft(ruleA, ACC_A, 1, 1, '決めごとA');
    const swappedB = await patchDraft(ruleB, ACC_A, 1, 0, '決めごとB');
    expect(swappedA.status).toBe(200);
    expect(swappedB.status).toBe(409);

    // Aだけ新しい順序、Bは古いまま = 部分適用。これが直す前の振る舞い。
    expect(draftRow(ruleA).sort_order).toBe(1);
    expect(draftRow(ruleB).sort_order).toBe(1);
  });

  test('一括口は全順序を1回で保存し、下書きの他の項目を壊さない', async () => {
    const ruleA = await makeRule(ACC_A, '決めごとA', 0);
    const ruleB = await makeRule(ACC_A, '決めごとB', 1);
    const ruleC = await makeRule(ACC_A, '決めごとC', 2);

    const res = await putOrder(ACC_A, [ruleC, ruleA, ruleB], KEY_OWNER);
    expect(res.status).toBe(200);
    expect(draftRow(ruleC).sort_order).toBe(0);
    expect(draftRow(ruleA).sort_order).toBe(1);
    expect(draftRow(ruleB).sort_order).toBe(2);

    // 並び順以外の下書き項目はそのまま残る。
    const name = sqlite.prepare(
      `SELECT json_extract(draft_json, '$.name') AS name
         FROM mileage_earning_rule_drafts WHERE rule_id = ?`,
    ).get(ruleC) as { name: string };
    expect(name.name).toBe('決めごとC');
  });

  test('101件(一覧APIの1頁目を超える件数)も全IDを1回で並び替える', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 101; i += 1) {
      ids.push(await makeRule(ACC_A, `決めごと${i}`, i));
    }

    // 先頭100件への打ち切りが残っていると、ここで全件不一致=409になる。
    const reversed = [...ids].reverse();
    const res = await putOrder(ACC_A, reversed, KEY_OWNER);
    expect(res.status).toBe(200);
    for (let i = 0; i < ids.length; i += 1) {
      expect(draftRow(ids[i]).sort_order).toBe(ids.length - 1 - i);
    }

    // 逆に100件だけの並びは拒否される = 全件一致を要求する口のまま。
    const truncated = await putOrder(ACC_A, reversed.slice(0, 100), KEY_OWNER);
    expect(truncated.status).not.toBe(200);
    expect(draftRow(ids[0]).sort_order).toBe(100);
  });

  test('一括保存で下書きの版が進むので、古い版の1件保存は競合になる', async () => {
    const ruleA = await makeRule(ACC_A, '決めごとA', 0);
    const ruleB = await makeRule(ACC_A, '決めごとB', 1);

    const res = await putOrder(ACC_A, [ruleB, ruleA], KEY_OWNER);
    expect(res.status).toBe(200);
    expect(draftRow(ruleA).version).toBe(2);
    expect(draftRow(ruleB).version).toBe(2);

    // 並び保存前に開いていた下書き(版1)の保存は競合で止まり、
    // 並び順を黙って戻す取りこぼしが起きない。
    const stale = await patchDraft(ruleA, ACC_A, 1, 9, '決めごとA改名');
    expect(stale.status).toBe(409);
    expect(draftRow(ruleA).sort_order).toBe(1);
  });

  test('他アカウントの決めごとを含む並びは拒否され、既存の順序を変えない', async () => {
    const ruleA = await makeRule(ACC_A, '決めごとA', 0);
    const ruleB = await makeRule(ACC_A, '決めごとB', 1);
    const other = await makeRule(ACC_B, '他店の決めごと', 0);

    const res = await putOrder(ACC_A, [ruleB, ruleA, other], KEY_OWNER);
    expect(res.status).not.toBe(200);
    expect(draftRow(ruleA).sort_order).toBe(0);
    expect(draftRow(ruleB).sort_order).toBe(1);
    expect(draftRow(other).sort_order).toBe(0);
  });

  test('件数が一覧と合わない並びは拒否され、既存の順序を変えない', async () => {
    const ruleA = await makeRule(ACC_A, '決めごとA', 0);
    const ruleB = await makeRule(ACC_A, '決めごとB', 1);

    const missing = await putOrder(ACC_A, [ruleA], KEY_OWNER);
    expect(missing.status).not.toBe(200);
    const extra = await putOrder(ACC_A, [ruleB, ruleA, 'rule-not-exists'], KEY_OWNER);
    expect(extra.status).not.toBe(200);
    expect(draftRow(ruleA).sort_order).toBe(0);
    expect(draftRow(ruleB).sort_order).toBe(1);
  });

  test('重複・空・文字列でない並びは拒否される', async () => {
    const ruleA = await makeRule(ACC_A, '決めごとA', 0);
    const ruleB = await makeRule(ACC_A, '決めごとB', 1);

    expect((await putOrder(ACC_A, [ruleA, ruleA], KEY_OWNER)).status).not.toBe(200);
    expect((await putOrder(ACC_A, [], KEY_OWNER)).status).not.toBe(200);
    expect((await putOrder(ACC_A, [ruleA, 123], KEY_OWNER)).status).not.toBe(200);
    expect(draftRow(ruleA).sort_order).toBe(0);
    expect(draftRow(ruleB).sort_order).toBe(1);
  });

  test('担当外アカウントの並び保存は止まり、順序を変えない', async () => {
    const other = await makeRule(ACC_B, '他店の決めごと', 0);
    const res = await putOrder(ACC_B, [other], KEY_A);
    expect(res.status).not.toBe(200);
    expect(draftRow(other).sort_order).toBe(0);
  });

  test('staff 相当の鍵と無認証は止まる(実auth)', async () => {
    const ruleA = await makeRule(ACC_A, '決めごとA', 0);
    expect((await putOrder(ACC_A, [ruleA], KEY_STAFF)).status).toBe(403);
    expect((await putOrder(ACC_A, [ruleA])).status).toBe(401);
    expect(draftRow(ruleA).sort_order).toBe(0);
  });
});
