import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { featureEnforcementMiddleware } from '../middleware/feature-enforcement.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { broadcasts } from './broadcasts.js';

const TENANT_ID = 'tenant-feature-gate';
const staff: AuthenticatedStaff = {
  id: 'owner-feature-gate',
  name: 'オーナー',
  role: 'owner',
  readOnly: false,
  tenantId: TENANT_ID,
};

function routeApp(db: D1Database) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', staff);
    await next();
  });
  instance.use('/api/*', featureEnforcementMiddleware);
  instance.route('/', broadcasts);
  return instance;
}

function insertAccount(testDb: SqliteD1, id: string): void {
  testDb.raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, `channel-${id}`, id, 'fixture', 'fixture', TENANT_ID);
}

function setBroadcastSetting(testDb: SqliteD1, accountId: string, enabled: boolean): void {
  testDb.raw.prepare(`
    INSERT INTO account_settings (id, line_account_id, key, value)
    VALUES (?, ?, 'feature.settings_bundle_v1', ?)
  `).run(
    `setting-${accountId}`,
    accountId,
    JSON.stringify({ version: 1, data: { features: { broadcasts: enabled } } }),
  );
}

describe('一斉配信routeの機能停止境界', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare(`
      INSERT INTO tenants (id, name, plan_key, plan_status)
      VALUES (?, '機能境界の統括', 'standard', 'active')
    `).run(TENANT_ID);
  });

  afterEach(() => {
    testDb.raw.close();
  });

  it('可視アカウントが0件の一覧は500にせず構造化403を返す', async () => {
    const response = await routeApp(testDb.db).request('/api/broadcasts', {}, { DB: testDb.db });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'FEATURE_DISABLED',
      featureId: 'broadcasts',
    });
  });

  it('解約後もGETで既存配信を読めるがPOSTで変更はできない', async () => {
    testDb.raw.prepare("UPDATE tenants SET plan_status = 'canceled' WHERE id = ?").run(TENANT_ID);
    insertAccount(testDb, 'account-1');
    setBroadcastSetting(testDb, 'account-1', true);

    const instance = routeApp(testDb.db);
    const read = await instance.request('/api/broadcasts', {}, { DB: testDb.db });
    expect(read.status).toBe(200);

    const write = await instance.request('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-1' }),
    }, { DB: testDb.db });
    expect(write.status).toBe(403);
    await expect(write.json()).resolves.toMatchObject({
      code: 'FEATURE_NOT_ENTITLED',
      reason: 'contract_unavailable',
    });
  });

  it('会社設定offは閲覧GETでも従来どおり拒否する', async () => {
    insertAccount(testDb, 'account-1');
    setBroadcastSetting(testDb, 'account-1', false);

    const response = await routeApp(testDb.db).request('/api/broadcasts', {}, { DB: testDb.db });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'FEATURE_DISABLED',
      reason: 'company_disabled',
    });
  });

  it('複数アカウント一覧は同じtenantの料金を1回だけ読み、D1呼出をN＋定数に保つ', async () => {
    for (const id of ['account-1', 'account-2', 'account-3']) {
      insertAccount(testDb, id);
      setBroadcastSetting(testDb, id, true);
    }
    let prepareCalls = 0;
    let tenantBillingReads = 0;
    const countedDb = new Proxy(testDb.db, {
      get(target, property, receiver) {
        if (property !== 'prepare') return Reflect.get(target, property, receiver);
        return (sql: string) => {
          prepareCalls += 1;
          if (/FROM tenants WHERE id = \?/i.test(sql)) tenantBillingReads += 1;
          return target.prepare(sql);
        };
      },
    });

    const response = await routeApp(countedDb).request('/api/broadcasts', {}, { DB: countedDb });
    expect(response.status).toBe(200);
    expect(tenantBillingReads).toBe(1);
    // 3件の設定読取 + scope/handlerの固定分。account件数に比例するのは設定だけ。
    expect(prepareCalls).toBeLessThanOrEqual(12);
  });
});
