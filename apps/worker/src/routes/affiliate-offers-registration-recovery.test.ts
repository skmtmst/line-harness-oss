import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Env } from '../index.js';

/**
 * Issue #686 差し戻し対応の実 Worker + 実 D1（better-sqlite3 に bootstrap.sql
 * を流したもの）による検証（案件 = affiliate_offers 側）。
 *
 * apps/worker/src/routes/affiliate-offers.ts は本物のまま mount し、
 * @line-crm/db はモックしない。
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
    `INSERT INTO tags (id, name, line_account_id, created_at) VALUES (?, ?, ?, '2026-01-01T00:00:00.000')`,
  ).run('tag-a1', 'account-aのタグ', ACCOUNT_A);
  sqlite.prepare(
    `INSERT INTO tags (id, name, line_account_id, created_at) VALUES (?, ?, ?, '2026-01-01T00:00:00.000')`,
  ).run('tag-b1', 'account-bのタグ', ACCOUNT_B);
}

function makeApp(db: D1Database, staff: { id: string; role: 'owner' | 'admin' | 'staff'; tenantId?: string }) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: staff.id, name: staff.id, role: staff.role, readOnly: false, tenantId: staff.tenantId ?? TENANT_ID });
    return next();
  });
  app.route('/', offersRoute);
  const env = { DB: db, WORKER_URL: 'https://worker.example.com' } as unknown as Env['Bindings'];
  return { app, env };
}

const OWNER = { id: 'env-owner', role: 'owner' as const };
const SCOPED = { id: 'scoped-staff', role: 'admin' as const };
const SCOPED_B = { id: 'scoped-staff-b', role: 'admin' as const };

let sqlite: Database.Database;
let db: D1Database;
let offersRoute: Awaited<typeof import('./affiliate-offers.js')>['affiliateOffers'];

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'), 'utf8'));
  sqlite.pragma('foreign_keys = OFF');
  seed(sqlite);
  db = asD1(sqlite);
  ({ affiliateOffers: offersRoute } = await import('./affiliate-offers.js'));
});

describe('POST /api/affiliate-offers — response-loss retry recovers the same registration (#686)', () => {
  test('同じ operationId での再送は、新規作成せず同じ案件を返す', async () => {
    const { app, env } = makeApp(db, OWNER);
    const body = {
      name: '秋の紹介キャンペーン',
      rewardAmount: 1000,
      lineAccountId: ACCOUNT_A,
      operationId: 'retry-offer-0001',
    };

    const first = await app.request('/api/affiliate-offers', { method: 'POST', body: JSON.stringify(body) }, env);
    expect(first.status).toBe(201);
    const firstJson = await first.json() as { data: { id: string } };

    const retry = await app.request('/api/affiliate-offers', { method: 'POST', body: JSON.stringify(body) }, env);
    expect(retry.status).toBe(201);
    const retryJson = await retry.json() as { data: { id: string } };

    expect(retryJson.data.id).toBe(firstJson.data.id);
    const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM affiliate_offers WHERE name = '秋の紹介キャンペーン'`)
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  test('【対比】operationId を付けない再送は、応答喪失を模すと二重作成される', async () => {
    const { app, env } = makeApp(db, OWNER);
    const body = { name: '重複確認用案件', lineAccountId: ACCOUNT_A };

    const first = await app.request('/api/affiliate-offers', { method: 'POST', body: JSON.stringify(body) }, env);
    const retry = await app.request('/api/affiliate-offers', { method: 'POST', body: JSON.stringify(body) }, env);
    const firstJson = await first.json() as { data: { id: string } };
    const retryJson = await retry.json() as { data: { id: string } };

    expect(retryJson.data.id).not.toBe(firstJson.data.id);
    const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM affiliate_offers WHERE name = '重複確認用案件'`)
      .get() as { n: number };
    expect(count.n).toBe(2);
  });
});

describe('POST /api/affiliate-offers — cross-account への作成を拒む (#686)', () => {
  test('account-a しか見えないスタッフは、account-b のタグを付けた案件を作れない', async () => {
    const { app, env } = makeApp(db, SCOPED);
    const res = await app.request('/api/affiliate-offers', {
      method: 'POST',
      body: JSON.stringify({ name: '越境確認案件', lineAccountId: ACCOUNT_A, tagId: 'tag-b1' }),
    }, env);
    expect(res.status).toBe(400);
    const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM affiliate_offers WHERE name = '越境確認案件'`)
      .get() as { n: number };
    expect(count.n).toBe(0);
  });

  test('account-a しか見えないスタッフは、lineAccountId を account-b にすり替えて作成できない', async () => {
    const { app, env } = makeApp(db, SCOPED);
    const res = await app.request('/api/affiliate-offers', {
      method: 'POST',
      body: JSON.stringify({ name: '越境確認案件2', lineAccountId: ACCOUNT_B }),
    }, env);
    expect(res.status).toBe(403);
    const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM affiliate_offers WHERE name = '越境確認案件2'`)
      .get() as { n: number };
    expect(count.n).toBe(0);
  });

  /*
   * 案件側も、操作UUIDの回収を LINEアカウントの内側だけで効かせる（#686 審査3）。
   * 回収SELECTから line_account_id を落とすと、別アカウントのスタッフが
   * 他店の operationId を送っただけで他店の案件（名前・報酬額）が返る。
   */
  test('別アカウントのスタッフが同じ operationId を送っても、他店の案件は返らない', async () => {
    const SHARED_OPERATION = 'shared-offer-operation-across-accounts';

    const a = makeApp(db, SCOPED);
    const created = await a.app.request('/api/affiliate-offers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'A店の秘密案件',
        rewardAmount: 9999,
        lineAccountId: ACCOUNT_A,
        operationId: SHARED_OPERATION,
      }),
    }, a.env);
    expect(created.status).toBe(201);
    const createdJson = await created.json() as {
      data: { id: string; name: string; rewardAmount: number; lineAccountId: string }
    };
    expect(createdJson.data.lineAccountId).toBe(ACCOUNT_A);

    const b = makeApp(db, SCOPED_B);
    const crossed = await b.app.request('/api/affiliate-offers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'B店の案件',
        rewardAmount: 100,
        lineAccountId: ACCOUNT_B,
        operationId: SHARED_OPERATION,
      }),
    }, b.env);
    expect(crossed.status).toBe(201);
    const crossedJson = await crossed.json() as {
      data: { id: string; name: string; rewardAmount: number; lineAccountId: string }
    };

    expect(crossedJson.data.id).not.toBe(createdJson.data.id);
    expect(crossedJson.data.lineAccountId).toBe(ACCOUNT_B);
    expect(crossedJson.data.name).toBe('B店の案件');
    expect(crossedJson.data.rewardAmount).toBe(100);
    expect(crossedJson.data.rewardAmount).not.toBe(9999);

    const rowA = sqlite.prepare(
      `SELECT name, reward_amount, line_account_id FROM affiliate_offers WHERE id = ?`,
    ).get(createdJson.data.id) as { name: string; reward_amount: number; line_account_id: string };
    expect(rowA.name).toBe('A店の秘密案件');
    expect(rowA.reward_amount).toBe(9999);
    expect(rowA.line_account_id).toBe(ACCOUNT_A);

    const total = sqlite.prepare(
      `SELECT COUNT(*) AS n FROM affiliate_offers WHERE operation_id = ?`,
    ).get(SHARED_OPERATION) as { n: number };
    expect(total.n).toBe(2);
  });

  test('【対比】同じスタッフは自分の見える account-a へは作成できる', async () => {
    const { app, env } = makeApp(db, SCOPED);
    const res = await app.request('/api/affiliate-offers', {
      method: 'POST',
      body: JSON.stringify({ name: '正常系確認案件', lineAccountId: ACCOUNT_A, tagId: 'tag-a1' }),
    }, env);
    expect(res.status).toBe(201);
  });
});

describe('PUT /api/affiliate-offers/:id — 途中保存後の再開は全項目を保存する (#686)', () => {
  test('全項目を送るPUTは、name・rewardAmountを含めて反映する', async () => {
    const { app, env } = makeApp(db, OWNER);
    const create = await app.request('/api/affiliate-offers', {
      method: 'POST',
      body: JSON.stringify({ name: '編集前の案件名', rewardAmount: 100, lineAccountId: ACCOUNT_A }),
    }, env);
    const { data: created } = await create.json() as { data: { id: string } };

    const full = await app.request(`/api/affiliate-offers/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: '編集後の案件名',
        rewardAmount: 500,
        description: '途中保存後に直した説明',
        isActive: false,
      }),
    }, env);
    expect(full.status).toBe(200);

    const row = sqlite.prepare(`SELECT name, reward_amount, description FROM affiliate_offers WHERE id = ?`)
      .get(created.id) as { name: string; reward_amount: number; description: string };
    expect(row.name).toBe('編集後の案件名');
    expect(row.reward_amount).toBe(500);
    expect(row.description).toBe('途中保存後に直した説明');
  });

  test('【対比】narrow なPUT（isActiveだけ）は、直した案件名・報酬額を失う', async () => {
    const { app, env } = makeApp(db, OWNER);
    const create = await app.request('/api/affiliate-offers', {
      method: 'POST',
      body: JSON.stringify({ name: '編集前の案件名2', rewardAmount: 100, lineAccountId: ACCOUNT_A }),
    }, env);
    const { data: created } = await create.json() as { data: { id: string } };

    // 旧実装（PR #1508 差し戻し版）の再開PUTは isActive しか送らない。
    const narrow = await app.request(`/api/affiliate-offers/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({ isActive: false }),
    }, env);
    expect(narrow.status).toBe(200);

    const row = sqlite.prepare(`SELECT name, reward_amount FROM affiliate_offers WHERE id = ?`)
      .get(created.id) as { name: string; reward_amount: number };
    // 直したはずの値が失われている＝narrow PUTでは画面上の編集が消えることの証明。
    expect(row.name).toBe('編集前の案件名2');
    expect(row.reward_amount).toBe(100);
  });
});
