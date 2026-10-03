import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Env } from '../index.js';

/**
 * F-23 追補（2026-10-03 オーナー指示 O担当）。
 *
 * 公開案件の報酬を変えたら、変えたあとの成果は新額、変える前の成果と
 * 旧支払は当時額で凍結する。初回 POST の応答喪失・古い POST の再送でも
 * 報酬の版を壊さないことを、実 Worker + 実 D1（bootstrap.sql）で確かめる。
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
     VALUES ('owner-1', '店長', 'owner', 'key-owner', ?, 'all')`,
  ).run(TENANT_ID);
  // account-b だけを見られるスタッフ（別店の版を回収しないことの確認用）。
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('scoped-staff-b', '担当者B', 'admin', 'key-scoped-staff-b', ?, 'accounts')`,
  ).run(TENANT_ID);
  sqlite.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('scoped-staff-b', ?, '2026-01-01T00:00:00.000')`,
  ).run(ACCOUNT_B);
}

function makeApp(db: D1Database, staff: { id: string; role: 'owner' | 'admin' | 'staff' }) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: staff.id, name: staff.id, role: staff.role, readOnly: false, tenantId: TENANT_ID });
    return next();
  });
  app.route('/', offersRoute);
  const env = { DB: db, WORKER_URL: 'https://worker.example.com' } as unknown as Env['Bindings'];
  return { app, env };
}

const OWNER = { id: 'owner-1', role: 'owner' as const };
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

const versionCountOf = (offerId: string) => (
  sqlite.prepare(`SELECT COUNT(*) AS n FROM affiliate_offer_versions WHERE offer_id = ?`).get(offerId) as { n: number }
).n;

const currentRewardOf = (offerId: string) => (
  sqlite.prepare(
    `SELECT reward_amount FROM affiliate_offer_versions WHERE offer_id = ? ORDER BY version_number DESC LIMIT 1`,
  ).get(offerId) as { reward_amount: number }
).reward_amount;

describe('F-23 ケース1: 初回POSTの応答喪失再送で報酬の初版を増やさない', () => {
  test('同account/同operationId/同本文の再送は案件行も最初の報酬版も1件のまま', async () => {
    const { app, env } = makeApp(db, OWNER);
    const body = {
      name: '初版固定キャンペーン',
      rewardAmount: 1000,
      lineAccountId: ACCOUNT_A,
      operationId: 'f23-first-post-retry-0001',
    };

    const first = await app.request('/api/affiliate-offers', { method: 'POST', body: JSON.stringify(body) }, env);
    expect(first.status).toBe(201);
    const firstJson = await first.json() as { data: { id: string } };
    expect(versionCountOf(firstJson.data.id)).toBe(1);

    const retry = await app.request('/api/affiliate-offers', { method: 'POST', body: JSON.stringify(body) }, env);
    expect(retry.status).toBe(201);
    const retryJson = await retry.json() as { data: { id: string } };
    expect(retryJson.data.id).toBe(firstJson.data.id);
    // 案件行だけでなく最初の報酬版も増えない。
    expect(versionCountOf(firstJson.data.id)).toBe(1);
    expect(currentRewardOf(firstJson.data.id)).toBe(1000);
  });

  test('初版保存失敗→同キー回収では必要な初版を一度だけ確保する', async () => {
    // 案件行の保存だけ通って版の保存に失敗した状態を直接作る。
    sqlite.prepare(
      `INSERT INTO affiliate_offers
         (id, name, description, reward_amount, reward_miles, mileage_program_id,
          line_account_id, tag_id, scenario_id, is_active, created_at, operation_id)
       VALUES ('offer-half-saved', '版なしで残った案件', '説明', 1000, 0, 'default',
          ?, NULL, NULL, 1, '2026-10-03T00:00:00.000+09:00', 'f23-half-saved-0001')`,
    ).run(ACCOUNT_A);
    expect(versionCountOf('offer-half-saved')).toBe(0);

    const { app, env } = makeApp(db, OWNER);
    const retry = await app.request('/api/affiliate-offers', {
      method: 'POST',
      body: JSON.stringify({
        name: '版なしで残った案件',
        rewardAmount: 1000,
        lineAccountId: ACCOUNT_A,
        operationId: 'f23-half-saved-0001',
      }),
    }, env);
    expect(retry.status).toBe(201);
    const retryJson = await retry.json() as { data: { id: string } };
    expect(retryJson.data.id).toBe('offer-half-saved');
    expect(versionCountOf('offer-half-saved')).toBe(1);
    expect(currentRewardOf('offer-half-saved')).toBe(1000);
  });
});

describe('F-23 ケース2: 報酬編集後の古いPOST再送は現在版を戻さない', () => {
  test('旧額で作成→新額へ変更→最初のPOSTを再送しても同案件・現在版は新額のまま', async () => {
    const { app, env } = makeApp(db, OWNER);
    const firstBody = {
      name: '報酬改定キャンペーン',
      rewardAmount: 1000,
      lineAccountId: ACCOUNT_A,
      operationId: 'f23-edit-then-retry-0001',
    };
    const created = await app.request('/api/affiliate-offers', { method: 'POST', body: JSON.stringify(firstBody) }, env);
    expect(created.status).toBe(201);
    const createdJson = await created.json() as { data: { id: string } };
    const offerId = createdJson.data.id;

    const edited = await app.request(`/api/affiliate-offers/${offerId}`, {
      method: 'PUT',
      body: JSON.stringify({ rewardAmount: 2000 }),
    }, env);
    expect(edited.status).toBe(200);
    expect(versionCountOf(offerId)).toBe(2);
    expect(currentRewardOf(offerId)).toBe(2000);

    // 最初のPOST（旧額1000の本文）を再送する。
    const replay = await app.request('/api/affiliate-offers', { method: 'POST', body: JSON.stringify(firstBody) }, env);
    expect(replay.status).toBe(201);
    const replayJson = await replay.json() as {
      data: { id: string; rewardAmount: number; name: string }
    };
    // 回収は同案件。
    expect(replayJson.data.id).toBe(offerId);
    // 現在報酬版と案件の額が旧本文へ戻らない（別assert）。
    expect(versionCountOf(offerId)).toBe(2);
    expect(currentRewardOf(offerId)).toBe(2000);
    const offerRow = sqlite.prepare(
      `SELECT reward_amount FROM affiliate_offers WHERE id = ?`,
    ).get(offerId) as { reward_amount: number };
    expect(offerRow.reward_amount).toBe(2000);
    expect(replayJson.data.rewardAmount).toBe(2000);
  });
});

describe('F-23 ケース2補足: 修正前の鍵なし初版を持つ案件の再送も版を増やさない', () => {
  test('旧フローで作られた初版がある再送は、そのまま同案件を返す', async () => {
    // 修正前のフロー（確認キーなし）で残った案件と初版を直接作る。
    sqlite.prepare(
      `INSERT INTO affiliate_offers
         (id, name, description, reward_amount, reward_miles, mileage_program_id,
          line_account_id, tag_id, scenario_id, is_active, created_at, operation_id)
       VALUES ('offer-legacy', '旧フロー案件', NULL, 1000, 0, 'default',
          ?, NULL, NULL, 1, '2026-09-01T00:00:00.000+09:00', 'f23-legacy-0001')`,
    ).run(ACCOUNT_A);
    sqlite.prepare(
      `INSERT INTO affiliate_offer_versions
         (id, offer_id, version_number, reward_amount, reward_miles, window_days, created_at)
       VALUES ('ver-legacy-1', 'offer-legacy', 1, 1000, 0, 30, '2026-09-01T00:00:00.000+09:00')`,
    ).run();
    expect(versionCountOf('offer-legacy')).toBe(1);

    const { app, env } = makeApp(db, OWNER);
    const retry = await app.request('/api/affiliate-offers', {
      method: 'POST',
      body: JSON.stringify({
        name: '旧フロー案件',
        rewardAmount: 1000,
        lineAccountId: ACCOUNT_A,
        operationId: 'f23-legacy-0001',
      }),
    }, env);
    expect(retry.status).toBe(201);
    const retryJson = await retry.json() as { data: { id: string } };
    expect(retryJson.data.id).toBe('offer-legacy');
    expect(versionCountOf('offer-legacy')).toBe(1);
    expect(currentRewardOf('offer-legacy')).toBe(1000);
  });
});

describe('F-23 ケース5: 別accountの同operationIdは他店の行・版を回収しない', () => {
  test('同じ確認キーでも店ごとに案件行と報酬版が分かれる', async () => {
    const SHARED = 'f23-shared-operation-across-accounts';
    const a = makeApp(db, OWNER);
    const createdA = await a.app.request('/api/affiliate-offers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'A店の案件',
        rewardAmount: 3000,
        lineAccountId: ACCOUNT_A,
        operationId: SHARED,
      }),
    }, a.env);
    expect(createdA.status).toBe(201);
    const jsonA = await createdA.json() as { data: { id: string } };

    const b = makeApp(db, SCOPED_B);
    const createdB = await b.app.request('/api/affiliate-offers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'B店の案件',
        rewardAmount: 500,
        lineAccountId: ACCOUNT_B,
        operationId: SHARED,
      }),
    }, b.env);
    expect(createdB.status).toBe(201);
    const jsonB = await createdB.json() as { data: { id: string } };

    expect(jsonB.data.id).not.toBe(jsonA.data.id);
    expect(versionCountOf(jsonA.data.id)).toBe(1);
    expect(versionCountOf(jsonB.data.id)).toBe(1);
    expect(currentRewardOf(jsonA.data.id)).toBe(3000);
    expect(currentRewardOf(jsonB.data.id)).toBe(500);
  });
});
