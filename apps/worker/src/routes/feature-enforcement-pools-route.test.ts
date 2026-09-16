import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { featureEnforcementMiddleware } from '../middleware/feature-enforcement.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { trafficPools } from './traffic-pools.js';

function staff(
  id: string,
  role: AuthenticatedStaff['role'] = 'owner',
): AuthenticatedStaff {
  return { id, name: id, role, readOnly: false, tenantId: DEFAULT_TENANT_ID };
}

function routeApp(current: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', current);
    await next();
  });
  instance.use('/api/*', featureEnforcementMiddleware);
  instance.route('/', trafficPools);
  return instance;
}

function setFeature(testDb: SqliteD1, accountId: string, enabled: boolean): void {
  testDb.raw.prepare(`
    INSERT INTO account_settings (id, line_account_id, key, value)
    VALUES (?, ?, 'feature.multi_store_hierarchy', ?)
    ON CONFLICT(line_account_id, key) DO UPDATE SET value = excluded.value
  `).run(`setting-multi-store-${accountId}`, accountId, JSON.stringify({ enabled }));
}

function seedAccountsAndPools(testDb: SqliteD1): void {
  for (const id of ['account-1', 'account-2']) {
    testDb.raw.prepare(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES (?, ?, ?, 'fixture', 'fixture', ?)
    `).run(id, `channel-${id}`, `店舗${id}`, DEFAULT_TENANT_ID);
  }
  for (const [id, account] of [['pool-1', 'account-1'], ['pool-2', 'account-2']] as const) {
    testDb.raw.prepare(`
      INSERT INTO traffic_pools
        (id, slug, name, active_account_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00')
    `).run(id, `slug-${id}`, `プール${id}`, account);
  }
}

function seedScopedStaff(testDb: SqliteD1): void {
  testDb.raw.prepare(`
    INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
    VALUES ('scoped-1', 'scoped-1', 'admin', 'key-scoped', ?, 'accounts')
  `).run(DEFAULT_TENANT_ID);
  testDb.raw.prepare(`
    INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
    VALUES ('scoped-1', 'account-2', '2026-09-01T00:00:00+09:00')
  `).run();
}

describe('プール管理routeの機能停止境界(#860)', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedAccountsAndPools(testDb);
  });

  afterEach(() => testDb.raw.close());

  it('設定行が無い契約は既定オフで閉じ、off/onで403/200が切り替わる', async () => {
    const target = routeApp(staff('env-owner'));
    const env = { DB: testDb.db } as Env['Bindings'];

    // 記録が無い＝カタログ既定の off。fail closed で管理APIを通さない。
    const missing = await target.request('/api/traffic-pools', {}, env);
    expect(missing.status).toBe(403);
    await expect(missing.json()).resolves.toMatchObject({
      success: false,
      code: 'FEATURE_DISABLED',
      featureId: 'multi_store_hierarchy',
    });

    setFeature(testDb, 'account-1', false);
    setFeature(testDb, 'account-2', false);
    const disabled = await target.request('/api/traffic-pools', {}, env);
    expect(disabled.status).toBe(403);
    await expect(disabled.json()).resolves.toMatchObject({
      code: 'FEATURE_DISABLED',
      reason: 'company_disabled',
    });

    setFeature(testDb, 'account-1', true);
    setFeature(testDb, 'account-2', true);
    const enabled = await target.request('/api/traffic-pools', {}, env);
    expect(enabled.status).toBe(200);
    const body = await enabled.json() as { data: Array<{ id: string }> };
    expect(body.data.map((pool) => pool.id).sort()).toEqual(['pool-1', 'pool-2']);
  });

  it('onのときowner/admin/staffは一覧を読めるが、作成・更新・削除はownerだけ', async () => {
    setFeature(testDb, 'account-1', true);
    setFeature(testDb, 'account-2', true);
    const env = { DB: testDb.db } as Env['Bindings'];

    for (const role of ['owner', 'admin', 'staff'] as const) {
      const list = await routeApp(staff(`${role}-reader`, role)).request('/api/traffic-pools', {}, env);
      expect(list.status, `${role}の一覧`).toBe(200);
    }

    for (const role of ['admin', 'staff'] as const) {
      const created = await routeApp(staff(`${role}-writer`, role)).request('/api/traffic-pools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // accountId は機能強制の境界解決用。作成本体は activeAccountId を見る。
        body: JSON.stringify({ slug: `pool-${role}`, name: '新しいプール', activeAccountId: 'account-1', accountId: 'account-1' }),
      }, env);
      expect(created.status, `${role}の作成`).toBe(403);
    }
    const ownerCreated = await routeApp(staff('env-owner')).request('/api/traffic-pools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'pool-owner', name: '新しいプール', activeAccountId: 'account-1', accountId: 'account-1' }),
    }, env);
    expect(ownerCreated.status).toBe(201);
  });

  it('担当account境界: 別accountのプール詳細は404、offにした側のaccountのプールも404', async () => {
    seedScopedStaff(testDb);
    setFeature(testDb, 'account-1', true);
    setFeature(testDb, 'account-2', true);
    const env = { DB: testDb.db } as Env['Bindings'];

    const scoped = routeApp(staff('scoped-1', 'admin'));
    // 担当外の account-1 のプールは見えない（詳細系は :id/accounts が実在route）。
    const foreign = await scoped.request('/api/traffic-pools/pool-1/accounts', {}, env);
    expect(foreign.status).toBe(404);
    const own = await scoped.request('/api/traffic-pools/pool-2/accounts', {}, env);
    expect(own.status).toBe(200);

    // account-2 側だけ機能を切ると、担当プールも境界ごと閉じる。
    // scoped-1 の見える account は account-2 だけなので、middleware が先に 403 を返す。
    setFeature(testDb, 'account-2', false);
    const ownDisabled = await scoped.request('/api/traffic-pools/pool-2/accounts', {}, env);
    expect(ownDisabled.status).toBe(403);
    await expect(ownDisabled.json()).resolves.toMatchObject({ code: 'FEATURE_DISABLED' });
    const scopedList = await scoped.request('/api/traffic-pools', {}, env);
    expect(scopedList.status).toBe(403);
    await expect(scopedList.json()).resolves.toMatchObject({ code: 'FEATURE_DISABLED' });

    // owner も、機能を切った account のプール詳細は取れない（一覧自体は残る）。
    const owner = routeApp(staff('env-owner'));
    const ownerForeign = await owner.request('/api/traffic-pools/pool-2/accounts', {}, env);
    expect(ownerForeign.status).toBe(404);
    const ownerList = await owner.request('/api/traffic-pools', {}, env);
    expect(ownerList.status).toBe(200);
  });

  it('offでも公開経路 /pool/:slug の振り分けは止めない（管理面だけを閉じる）', async () => {
    setFeature(testDb, 'account-1', false);
    setFeature(testDb, 'account-2', false);
    const env = { DB: testDb.db } as Env['Bindings'];

    // 機能 middleware は /api/ だけに掛かる。LINE利用者向けの振り分けURLは維持。
    const redirect = await routeApp(staff('env-owner')).request('/pool/slug-pool-1', {}, env);
    expect(redirect.status).toBe(302);
  });
});
