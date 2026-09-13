import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Env } from '../index.js';

/**
 * Issue #686 差し戻し対応の実 Worker + 実 D1（better-sqlite3 に bootstrap.sql
 * を流したもの）による検証。
 *
 *  1. commit 後に応答だけ失われて再送されても、安定した操作UUID
 *     (operationId) で同じ登録を回収し、二重作成しない。
 *  2. 途中保存後に直した項目は、全項目を送るPUTで失われない
 *     （narrow な PUT だと失われることの対比で示す）。
 *  3. 選択中LINEアカウントの範囲外（cross-account）へは作成・参照できない。
 *
 * `apps/worker/src/routes/affiliates.ts` は本物のまま mount し、
 * `@line-crm/db` はモックしない。DB は better-sqlite3 + bootstrap.sql の
 * 実SQLiteで、D1 の prepare/bind/first/all/run/batch だけを被せる。
 */

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
      } as unknown as D1PreparedStatement);
      return bound([]);
    },
    async batch<T>(statements: D1PreparedStatement[]) {
      const results = [];
      sqlite.exec('BEGIN');
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

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const ACCOUNT_A = 'account-a';
const ACCOUNT_B = 'account-b';

function seed(sqlite: Database.Database) {
  const insertAccount = (id: string, name: string) => {
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', ?)`,
    ).run(id, `channel-${id}`, name, TENANT_ID);
  };
  insertAccount(ACCOUNT_A, '本店');
  insertAccount(ACCOUNT_B, '別店');

  // account-a だけを見られるスタッフ（cross-account の境界を確かめる側）。
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('scoped-staff', '担当者A', 'admin', 'key-scoped-staff', ?, 'accounts')`,
  ).run(TENANT_ID);
  sqlite.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('scoped-staff', ?, '2026-01-01T00:00:00.000')`,
  ).run(ACCOUNT_A);

  // account-b だけを見られるスタッフ。操作UUIDの回収が account を跨がない
  // ことを確かめる側（#686 審査3）。
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('scoped-staff-b', '担当者B', 'admin', 'key-scoped-staff-b', ?, 'accounts')`,
  ).run(TENANT_ID);
  sqlite.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('scoped-staff-b', ?, '2026-01-01T00:00:00.000')`,
  ).run(ACCOUNT_B);

  sqlite.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, '2026-01-01T00:00:00.000', '2026-01-01T00:00:00.000')`,
  ).run('friend-a1', 'Ua1', '友だちA', ACCOUNT_A);
  sqlite.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, '2026-01-01T00:00:00.000', '2026-01-01T00:00:00.000')`,
  ).run('friend-b1', 'Ub1', '友だちB', ACCOUNT_B);
}

function makeApp(db: D1Database, staff: { id: string; role: 'owner' | 'admin' | 'staff'; tenantId?: string }) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: staff.id, name: staff.id, role: staff.role, readOnly: false, tenantId: staff.tenantId ?? TENANT_ID });
    return next();
  });
  app.route('/', affiliatesRoute);
  const env = { DB: db, WORKER_URL: 'https://worker.example.com' } as unknown as Env['Bindings'];
  return { app, env };
}

// The scope-restricted staff row must be real (getVisibleLineAccountScope falls
// back to full/unscoped access when getStaffById finds nothing), so `env-owner`
// is used only for the "unrestricted" side of each test.
const OWNER = { id: 'env-owner', role: 'owner' as const };
const SCOPED = { id: 'scoped-staff', role: 'admin' as const };
const SCOPED_B = { id: 'scoped-staff-b', role: 'admin' as const };

let sqlite: Database.Database;
let db: D1Database;
let affiliatesRoute: Awaited<typeof import('./affiliates.js')>['affiliates'];

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'), 'utf8'));
  sqlite.pragma('foreign_keys = OFF');
  seed(sqlite);
  db = asD1(sqlite);
  ({ affiliates: affiliatesRoute } = await import('./affiliates.js'));
});

describe('POST /api/affiliates — response-loss retry recovers the same registration (#686)', () => {
  test('同じ operationId での再送は、新規作成せず同じ紹介者を返す', async () => {
    const { app, env } = makeApp(db, OWNER);
    const body = {
      name: '紹介パートナー',
      lineAccountId: ACCOUNT_A,
      friendId: 'friend-a1',
      issueInitialLink: true,
      operationId: 'retry-operation-0001',
    };

    const first = await app.request('/api/affiliates', { method: 'POST', body: JSON.stringify(body) }, env);
    expect(first.status).toBe(201);
    const firstJson = await first.json() as { data: { id: string }; link: { refCode: string } | null };

    // commit 後に応答だけ失われた想定で、同じ operationId のまま再送する。
    const retry = await app.request('/api/affiliates', { method: 'POST', body: JSON.stringify(body) }, env);
    expect(retry.status).toBe(201);
    const retryJson = await retry.json() as { data: { id: string }; link: { refCode: string } | null };

    expect(retryJson.data.id).toBe(firstJson.data.id);
    expect(retryJson.link?.refCode).toBe(firstJson.link?.refCode);

    const affiliateCount = sqlite.prepare(
      `SELECT COUNT(*) AS n FROM affiliates WHERE friend_id = 'friend-a1'`,
    ).get() as { n: number };
    expect(affiliateCount.n).toBe(1);

    const linkCount = sqlite.prepare(
      `SELECT COUNT(*) AS n FROM affiliate_links WHERE affiliate_id = ?`,
    ).get(firstJson.data.id) as { n: number };
    expect(linkCount.n).toBe(1);
  });

  test('同じ operationId の同時2実行でも、紹介者もリンクも1本に収まる', async () => {
    const { app, env } = makeApp(db, OWNER);
    const body = {
      name: '同時実行パートナー',
      lineAccountId: ACCOUNT_A,
      issueInitialLink: true,
      operationId: 'concurrent-operation-0001',
    };

    // 逐次の再送ではなく、同じ操作UUIDを2本まとめて投げる。read-then-write
    // だと両方が「まだリンクが無い」と読み、リンクが2本できる（#686 審査2）。
    const [first, second] = await Promise.all([
      app.request('/api/affiliates', { method: 'POST', body: JSON.stringify(body) }, env),
      app.request('/api/affiliates', { method: 'POST', body: JSON.stringify(body) }, env),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstJson = await first.json() as { data: { id: string }; link: { refCode: string } | null };
    const secondJson = await second.json() as { data: { id: string }; link: { refCode: string } | null };

    expect(secondJson.data.id).toBe(firstJson.data.id);
    expect(secondJson.link?.refCode).toBe(firstJson.link?.refCode);

    const affiliateCount = sqlite.prepare(
      `SELECT COUNT(*) AS n FROM affiliates WHERE name = '同時実行パートナー'`,
    ).get() as { n: number };
    expect(affiliateCount.n).toBe(1);

    const linkCount = sqlite.prepare(
      `SELECT COUNT(*) AS n FROM affiliate_links WHERE affiliate_id = ?`,
    ).get(firstJson.data.id) as { n: number };
    expect(linkCount.n).toBe(1);
  });

  test('【対比】operationId を付けない再送は、応答喪失を模すと二重作成される', async () => {
    const { app, env } = makeApp(db, OWNER);
    const body = { name: '重複確認用', lineAccountId: ACCOUNT_A };

    const first = await app.request('/api/affiliates', { method: 'POST', body: JSON.stringify(body) }, env);
    const retry = await app.request('/api/affiliates', { method: 'POST', body: JSON.stringify(body) }, env);
    const firstJson = await first.json() as { data: { id: string } };
    const retryJson = await retry.json() as { data: { id: string } };

    expect(retryJson.data.id).not.toBe(firstJson.data.id);
    const count = sqlite.prepare(
      `SELECT COUNT(*) AS n FROM affiliates WHERE name = '重複確認用'`,
    ).get() as { n: number };
    expect(count.n).toBe(2);
  });
});

describe('POST /api/affiliates — cross-account への作成を拒む (#686)', () => {
  test('account-a しか見えないスタッフは、account-b の友だちに結びつけられない', async () => {
    const { app, env } = makeApp(db, SCOPED);
    const res = await app.request('/api/affiliates', {
      method: 'POST',
      body: JSON.stringify({ name: '越境確認', friendId: 'friend-b1' }),
    }, env);
    expect(res.status).toBe(404);
    const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM affiliates WHERE name = '越境確認'`).get() as { n: number };
    expect(count.n).toBe(0);
  });

  test('account-a しか見えないスタッフは、lineAccountId を account-b にすり替えて作成できない', async () => {
    const { app, env } = makeApp(db, SCOPED);
    const res = await app.request('/api/affiliates', {
      method: 'POST',
      body: JSON.stringify({ name: '越境確認2', lineAccountId: ACCOUNT_B }),
    }, env);
    expect(res.status).toBe(404);
    const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM affiliates WHERE name = '越境確認2'`).get() as { n: number };
    expect(count.n).toBe(0);
  });

  test('【対比】同じスタッフは自分の見える account-a へは作成できる', async () => {
    const { app, env } = makeApp(db, SCOPED);
    const res = await app.request('/api/affiliates', {
      method: 'POST',
      body: JSON.stringify({ name: '正常系確認', lineAccountId: ACCOUNT_A }),
    }, env);
    expect(res.status).toBe(201);
  });

  /*
   * 操作UUIDの回収は、tenant と LINEアカウントの内側だけで効かせる（#686 審査3）。
   *
   * 回収SELECTから tenant_id / line_account_id を落とすと、operation_id だけで
   * 引くことになる。そうすると別アカウントのスタッフが他店の operationId を
   * 送っただけで、他店の紹介者の名前・コード・報酬率がそのまま返る。
   * 作成の入口ガードは lineAccountId を見ているので通ってしまい、
   * 回収の一手前で漏れる。ここはその経路だけを見張る。
   */
  test('別アカウントのスタッフが同じ operationId を送っても、他店の紹介者は返らない', async () => {
    const SHARED_OPERATION = 'shared-operation-across-accounts';

    // account-a 側で、見分けのつく値を持つ紹介者を作る。
    const a = makeApp(db, SCOPED);
    const created = await a.app.request('/api/affiliates', {
      method: 'POST',
      body: JSON.stringify({
        name: 'A店の秘密パートナー',
        commissionRate: 42,
        lineAccountId: ACCOUNT_A,
        operationId: SHARED_OPERATION,
      }),
    }, a.env);
    expect(created.status).toBe(201);
    const createdJson = await created.json() as {
      data: { id: string; name: string; code: string; commissionRate: number; lineAccountId: string }
    };
    expect(createdJson.data.lineAccountId).toBe(ACCOUNT_A);

    // account-b しか見えないスタッフが、同じ operationId を送る。
    const b = makeApp(db, SCOPED_B);
    const crossed = await b.app.request('/api/affiliates', {
      method: 'POST',
      body: JSON.stringify({
        name: 'B店のパートナー',
        lineAccountId: ACCOUNT_B,
        operationId: SHARED_OPERATION,
      }),
    }, b.env);
    expect(crossed.status).toBe(201);
    const crossedJson = await crossed.json() as {
      data: { id: string; name: string; code: string; commissionRate: number; lineAccountId: string }
    };

    // A店の登録が回収されて返っていないこと。返るのはB店の自分の登録。
    expect(crossedJson.data.id).not.toBe(createdJson.data.id);
    expect(crossedJson.data.lineAccountId).toBe(ACCOUNT_B);
    expect(crossedJson.data.name).toBe('B店のパートナー');
    expect(crossedJson.data.name).not.toBe(createdJson.data.name);
    expect(crossedJson.data.code).not.toBe(createdJson.data.code);
    expect(crossedJson.data.commissionRate).not.toBe(42);

    // A店側の行は触られていない。
    const rowA = sqlite.prepare(
      `SELECT name, commission_rate, line_account_id FROM affiliates WHERE id = ?`,
    ).get(createdJson.data.id) as { name: string; commission_rate: number; line_account_id: string };
    expect(rowA.name).toBe('A店の秘密パートナー');
    expect(rowA.commission_rate).toBe(42);
    expect(rowA.line_account_id).toBe(ACCOUNT_A);

    // 同じ operationId でも、アカウントが違えば別の行として残る。
    const total = sqlite.prepare(
      `SELECT COUNT(*) AS n FROM affiliates WHERE operation_id = ?`,
    ).get(SHARED_OPERATION) as { n: number };
    expect(total.n).toBe(2);
  });
});

describe('PUT /api/affiliates/:id — 途中保存後の再開は全項目を保存する (#686)', () => {
  test('全項目を送るPUTは、name・commissionRateを含めて反映する', async () => {
    const { app, env } = makeApp(db, OWNER);
    const create = await app.request('/api/affiliates', {
      method: 'POST',
      body: JSON.stringify({ name: '編集前の名前', commissionRate: 10, lineAccountId: ACCOUNT_A }),
    }, env);
    const { data: created } = await create.json() as { data: { id: string } };

    // 途中保存の失敗後、ユーザーが名前と報酬率を直してから再開した想定。
    const full = await app.request(`/api/affiliates/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: '編集後の名前',
        commissionRate: 25,
        email: 'partner@example.com',
        holdDays: 5,
        payoutCycle: '月末締め翌月払い',
        notifyOnConversion: true,
        isActive: true,
      }),
    }, env);
    expect(full.status).toBe(200);

    const row = sqlite.prepare(`SELECT name, commission_rate, email FROM affiliates WHERE id = ?`)
      .get(created.id) as { name: string; commission_rate: number; email: string };
    expect(row.name).toBe('編集後の名前');
    expect(row.commission_rate).toBe(25);
    expect(row.email).toBe('partner@example.com');
  });

  test('【対比】narrow なPUT（isActiveなど一部項目だけ）は、直した名前・報酬率を失う', async () => {
    const { app, env } = makeApp(db, OWNER);
    const create = await app.request('/api/affiliates', {
      method: 'POST',
      body: JSON.stringify({ name: '編集前の名前2', commissionRate: 10, lineAccountId: ACCOUNT_A }),
    }, env);
    const { data: created } = await create.json() as { data: { id: string } };

    // ユーザーは画面上で名前・報酬率を直したが、旧実装の再開PUTは
    // email/holdDays/payoutCycle/notifyOnConversion/isActive しか送らない。
    const narrow = await app.request(`/api/affiliates/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        email: 'partner2@example.com',
        holdDays: 5,
        payoutCycle: '月末締め翌月払い',
        notifyOnConversion: true,
        isActive: true,
      }),
    }, env);
    expect(narrow.status).toBe(200);

    const row = sqlite.prepare(`SELECT name, commission_rate FROM affiliates WHERE id = ?`)
      .get(created.id) as { name: string; commission_rate: number };
    // 直したはずの値が失われている＝narrow PUTでは画面上の編集が消えることの証明。
    expect(row.name).toBe('編集前の名前2');
    expect(row.commission_rate).toBe(10);
  });
});
