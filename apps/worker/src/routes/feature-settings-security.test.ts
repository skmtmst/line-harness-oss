import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

const access = vi.hoisted(() => ({ canAccess: vi.fn(async () => true) }));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: access.canAccess,
}));

import { expectedMenuItemOrder } from '@line-crm/shared';

const { featureSettings, NEN_SPECIALIZED_FEATURES } = await import('./feature-settings.js');

/** 画面が送るのと同じ、全区分・全項目の完全な並び。deliveryだけ入れ替える。 */
const FULL_ITEM_ORDER = {
  ...expectedMenuItemOrder(new Set(NEN_SPECIALIZED_FEATURES)),
  delivery: ['broadcasts', 'scenarios', 'reminders', 'auto-replies', 'friend-add-settings', 'webinars'],
};

function app(role: 'owner' | 'admin' | 'staff' = 'owner') {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: role,
      name: role,
      role,
      readOnly: false,
      tenantId: 'tenant-a',
    });
    await next();
  });
  instance.route('/', featureSettings);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  access.canAccess.mockResolvedValue(true);
});

describe('feature settings scope and versioning', () => {
  it.each([
    { label: '利用中', environment: 'true', packs: ['restaurant'], enabled: true, plan: 'active', expected: true },
    { label: '環境停止', environment: 'false', packs: ['restaurant'], enabled: true, plan: 'active', expected: false },
    { label: '飲食パックなし', environment: 'true', packs: [], enabled: true, plan: 'active', expected: false },
    { label: '店が停止', environment: 'true', packs: ['restaurant'], enabled: false, plan: 'active', expected: false },
    { label: '課金状態によらず利用判定を返す同梱機能', environment: 'true', packs: ['restaurant'], enabled: true, plan: 'canceled', expected: true },
  ])('飲食の情報の表示判定：$label', async ({ environment, packs, enabled, plan, expected }) => {
    const testDb = createTestD1();
    try {
      testDb.raw.prepare('INSERT INTO tenants(id,name,plan_key,plan_status,feature_packs) VALUES(?,?,?,?,?)')
        .run('tenant-a', '統括', 'standard', plan, JSON.stringify(packs));
      testDb.raw.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id)
        VALUES('account-1','店舗','channel-1','s','t','tenant-a'),('account-2','別店舗','channel-2','s','t','tenant-a')`);
      testDb.raw.prepare(`INSERT INTO account_settings(id,line_account_id,key,value)
        VALUES('bundle','account-1','feature.settings_bundle_v1',?)`)
        .run(JSON.stringify({ version: 1, data: { features: { restaurant_test: enabled } } }));
      // 同じ統括でも店の設定を混ぜない。旧保存も読む。
      testDb.raw.exec(`INSERT INTO account_settings(id,line_account_id,key,value)
        VALUES('legacy','account-2','feature.restaurant_test','{"enabled":false}')`);
      for (const [accountId, visible] of [['account-1', expected], ['account-2', false]] as const) {
        const response = await app('staff').request(
          `/api/settings/features/visibility?account_id=${accountId}`, {},
          { DB: testDb.db, DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: environment },
        );
        expect(response.status).toBe(200);
        const body = await response.json() as { data: { features: Record<string, boolean> } };
        expect(body.data.features.restaurant_test).toBe(visible);
        expect(Object.keys(body.data)).toEqual(['features']);
      }
    } finally {
      testDb.raw.close();
    }
  });

  it('管理GETはstaffを拒否し、owner/adminだけに返す', async () => {
    const testDb = createTestD1();
    try {
      for (const role of ['owner', 'admin'] as const) {
        const response = await app(role).request(
          '/api/settings/features?account_id=account-1',
          {},
          { DB: testDb.db, RESTAURANT_TEST_ENABLED: 'false' },
        );
        expect(response.status).toBe(200);
      }
      const denied = await app('staff').request(
        '/api/settings/features?account_id=account-1',
        {},
        { DB: testDb.db, RESTAURANT_TEST_ENABLED: 'false' },
      );
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ success: false, error: expect.any(String) });
    } finally {
      testDb.raw.close();
    }
  });

  it('staff用GETは表示booleanだけを返し、契約・理由・保存値・並び・版を返さない', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.prepare(
        `INSERT INTO account_settings (id, line_account_id, key, value)
         VALUES ('setting-scenarios', 'account-1', 'feature.scenarios', '{"enabled":false}'),
                ('setting-catalog', 'account-1', 'feature.specialized.catalog', '[]')`,
      ).run();
      const response = await app('staff').request(
        '/api/settings/features/visibility?account_id=account-1',
        {},
        { DB: testDb.db, RESTAURANT_TEST_ENABLED: 'false' },
      );
      expect(response.status).toBe(200);
      const body = await response.json() as {
        success: boolean;
        data: { features: Record<string, unknown> };
      };
      expect(Object.keys(body)).toEqual(['success', 'data']);
      expect(Object.keys(body.data)).toEqual(['features']);
      expect(Object.values(body.data.features).every((value) => typeof value === 'boolean')).toBe(true);
      expect(body.data.features.scenarios).toBe(false);
      expect(body.data.features.nen_campaigns).toBe(false);
      for (const forbidden of [
        'featureStates', 'version', 'sidebarOrder', 'sidebarItemOrder',
        'parentChildMode', 'specializedFeatureKeys', 'contract', 'reason', 'history',
      ]) {
        expect(forbidden in body.data).toBe(false);
      }
    } finally {
      testDb.raw.close();
    }
  });

  it.each([
    '/api/settings/features/visibility',
    '/api/settings/features',
  ])('%s はaccount_idなしを構造化400にする', async (path) => {
    const response = await app(path.endsWith('/visibility') ? 'staff' : 'admin').request(
      path,
      {},
      { DB: { prepare: vi.fn() } as unknown as D1Database },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'FEATURE_SETTINGS_ACCOUNT_REQUIRED',
    });
  });

  it('staff用GETは空scope・別accountをDB読取前に構造化403にする', async () => {
    access.canAccess.mockResolvedValue(false);
    const prepare = vi.fn();
    const response = await app('staff').request(
      '/api/settings/features/visibility?account_id=other',
      {},
      { DB: { prepare } as unknown as D1Database },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'FEATURE_SETTINGS_SCOPE_FORBIDDEN',
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each(['GET', 'PUT'] as const)('%s rejects an inaccessible account before DB reads', async (method) => {
    access.canAccess.mockResolvedValue(false);
    const prepare = vi.fn();
    const response = await app().request('/api/settings/features?account_id=other', {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'PUT'
        ? JSON.stringify({ expectedVersion: 0, features: {} })
        : undefined,
    }, { DB: { prepare } as unknown as D1Database });

    expect(response.status).toBe(403);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('saves one bundle row and returns 409 to a stale writer', async () => {
    const testDb = createTestD1();
    try {
      const first = await app().request('/api/settings/features?account_id=account-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: 0,
          reason: 'テスト',
          features: { scenarios: false },
          sidebarItemOrder: FULL_ITEM_ORDER,
        }),
      }, { DB: testDb.db, DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true' });
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ success: true, data: { version: 1 } });

      const stale = await app().request('/api/settings/features?account_id=account-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 0, reason: 'テスト', features: { scenarios: true } }),
      }, { DB: testDb.db, DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true' });
      expect(stale.status).toBe(409);

      const loaded = await app().request(
        '/api/settings/features?account_id=account-1',
        {},
        { DB: testDb.db, DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true' },
      );
      expect(await loaded.json()).toMatchObject({
        success: true,
        data: {
          version: 1,
          features: { scenarios: false },
          sidebarItemOrder: FULL_ITEM_ORDER,
        },
      });
    } finally {
      testDb.raw.close();
    }
  });

  it('一括保存でも無効環境の飲食店テストは無効で残る（画面の保存後再読込の前提）', async () => {
    const testDb = createTestD1();
    try {
      const saved = await app().request('/api/settings/features?account_id=account-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: 0,
          reason: 'テスト',
          features: { restaurant_test: true, scenarios: false },
        }),
      }, { DB: testDb.db, RESTAURANT_TEST_ENABLED: 'false' });
      expect(saved.status).toBe(200);

      const loaded = await app().request(
        '/api/settings/features?account_id=account-1',
        {},
        { DB: testDb.db, RESTAURANT_TEST_ENABLED: 'false' },
      );
      expect(await loaded.json()).toMatchObject({
        success: true,
        data: { features: { restaurant_test: false, scenarios: false } },
      });
    } finally {
      testDb.raw.close();
    }
  });

  it('rejects duplicate ordering, non-boolean values, and feature IDs outside the catalog', async () => {
    const testDb = createTestD1();
    try {
      const duplicate = await app().request('/api/settings/features?account_id=account-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: 0,
          reason: 'テスト',
          sidebarItemOrder: { delivery: ['scenarios', 'scenarios'] },
        }),
      }, { DB: testDb.db, DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true' });
      expect(duplicate.status).toBe(400);

      const invalid = await app().request('/api/settings/features?account_id=account-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 0, reason: 'テスト', features: { scenarios: 'off' } }),
      }, { DB: testDb.db, DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true' });
      expect(invalid.status).toBe(400);

      const unknown = await app().request('/api/settings/features?account_id=account-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 0, reason: 'テスト', features: { not_in_feature_catalog: true } }),
      }, { DB: testDb.db, DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true' });
      expect(unknown.status).toBe(400);
      expect(await unknown.json()).toMatchObject({
        success: false,
        error: '知らない機能です: not_in_feature_catalog',
      });

      for (const removed of [
        'reservation_ledger',
        'multi_store_bulk_updates',
        'external_reservations',
        'google_business_profile',
      ]) {
        const response = await app().request('/api/settings/features?account_id=account-1', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedVersion: 0, reason: 'テスト', features: { [removed]: true } }),
        }, { DB: testDb.db, DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true' });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          success: false,
          error: `知らない機能です: ${removed}`,
        });
      }
    } finally {
      testDb.raw.close();
    }
  });

  it('旧保存値の幽霊キーを応答へ戻さず、bookingの保存値だけを維持する', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.prepare(`
        INSERT INTO account_settings (id, line_account_id, key, value)
        VALUES
          ('legacy-reservation-ledger', 'account-1', 'feature.reservation_ledger', '{"enabled":true}'),
          ('legacy-bulk', 'account-1', 'feature.multi_store_bulk_updates', '{"enabled":true}'),
          ('legacy-external', 'account-1', 'feature.external_reservations', '{"enabled":true}'),
          ('legacy-google', 'account-1', 'feature.google_business_profile', '{"enabled":true}'),
          ('legacy-booking', 'account-1', 'feature.booking', '{"enabled":false}')
      `).run();

      const loaded = await app().request(
        '/api/settings/features?account_id=account-1',
        {},
        { DB: testDb.db, DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true' },
      );
      expect(loaded.status).toBe(200);
      const body = await loaded.json() as {
        data: { features: Record<string, boolean>; featureStates: Record<string, unknown> };
      };
      expect(body.data.features.booking).toBe(false);
      expect(body.data.featureStates.booking).toMatchObject({
        featureId: 'booking',
        companyEnabled: false,
        reason: 'company_disabled',
      });
      for (const removed of [
        'reservation_ledger',
        'multi_store_bulk_updates',
        'external_reservations',
        'google_business_profile',
      ]) {
        expect(body.data.features).not.toHaveProperty(removed);
        expect(body.data.featureStates).not.toHaveProperty(removed);
      }

      testDb.raw.prepare(`
        INSERT INTO account_settings (id, line_account_id, key, value)
        VALUES ('old-bundle', 'account-1', 'feature.settings_bundle_v1', ?)
      `).run(JSON.stringify({
        version: 7,
        data: {
          features: {
            booking: true,
            reservation_ledger: true,
            multi_store_bulk_updates: true,
            external_reservations: true,
            google_business_profile: true,
          },
          sidebarOrder: null,
          sidebarItemOrder: null,
        },
      }));
      const bundled = await app().request(
        '/api/settings/features?account_id=account-1',
        {},
        { DB: testDb.db, DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true' },
      );
      expect(bundled.status).toBe(200);
      const bundledBody = await bundled.json() as {
        data: { version: number; features: Record<string, boolean>; featureStates: Record<string, unknown> };
      };
      expect(bundledBody.data.version).toBe(7);
      expect(bundledBody.data.features.booking).toBe(true);
      for (const removed of [
        'reservation_ledger',
        'multi_store_bulk_updates',
        'external_reservations',
        'google_business_profile',
      ]) {
        expect(bundledBody.data.features).not.toHaveProperty(removed);
        expect(bundledBody.data.featureStates).not.toHaveProperty(removed);
      }
    } finally {
      testDb.raw.close();
    }
  });
});
