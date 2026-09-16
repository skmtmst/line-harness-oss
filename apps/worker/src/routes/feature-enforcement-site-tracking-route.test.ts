import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { featureEnforcementMiddleware } from '../middleware/feature-enforcement.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { siteTracking } from './site-tracking.js';

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
  instance.route('/', siteTracking);
  return instance;
}

function setFeature(testDb: SqliteD1, accountId: string, key: string, enabled: boolean): void {
  testDb.raw.prepare(`
    INSERT INTO account_settings (id, line_account_id, key, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(line_account_id, key) DO UPDATE SET value = excluded.value
  `).run(`setting-${key}-${accountId}`, accountId, `feature.${key}`, JSON.stringify({ enabled }));
}

function seedAccounts(testDb: SqliteD1): void {
  for (const id of ['account-1', 'account-2']) {
    testDb.raw.prepare(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES (?, ?, ?, 'fixture', 'fixture', ?)
    `).run(id, `channel-${id}`, `店舗${id}`, DEFAULT_TENANT_ID);
    testDb.raw.prepare(`
      INSERT INTO site_tracking_keys (id, line_account_id, tracking_key)
      VALUES (?, ?, ?)
    `).run(`key-${id}`, id, `hk_${id === 'account-1' ? 'a'.repeat(32) : 'b'.repeat(32)}`);
  }
  testDb.raw.prepare(`
    INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
    VALUES ('scoped-1', 'scoped-1', 'admin', 'key-scoped', ?, 'accounts')
  `).run(DEFAULT_TENANT_ID);
  testDb.raw.prepare(`
    INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
    VALUES ('scoped-1', 'account-2', '2026-09-01T00:00:00+09:00')
  `).run();
}

function collectBody(account: 'account-1' | 'account-2') {
  return {
    visitorId: 'visitor-0001',
    trackingKey: `hk_${account === 'account-1' ? 'a'.repeat(32) : 'b'.repeat(32)}`,
    eventType: 'page_view',
    host: 'example.com',
    path: '/',
  };
}

function eventCount(testDb: SqliteD1, accountId: string): number {
  const row = testDb.raw.prepare(
    'SELECT COUNT(*) AS n FROM site_events WHERE line_account_id = ?',
  ).get(accountId) as { n: number };
  return row.n;
}

async function postCollect(app: ReturnType<typeof routeApp>, env: Env['Bindings'], account: 'account-1' | 'account-2') {
  return app.request('/api/site/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collectBody(account)),
  }, env);
}

describe('サイト計測キーのroute機能停止境界(#859)', () => {
  let testDb: SqliteD1;
  let env: Env['Bindings'];

  beforeEach(() => {
    testDb = createTestD1();
    seedAccounts(testDb);
    env = { DB: testDb.db } as Env['Bindings'];
  });

  afterEach(() => testDb.raw.close());

  it('記録が無い契約はカタログ既定onで収集・参照ともに動く', async () => {
    const app = routeApp(staff('env-owner'));

    const collect = await postCollect(app, env, 'account-1');
    expect(collect.status).toBe(204);
    expect(eventCount(testDb, 'account-1')).toBe(1);

    const pages = await app.request('/api/site/pages?accountId=account-1', {}, env);
    expect(pages.status).toBe(200);
  });

  it('offのaccountは公開収集口が204を返しつつ何も記録しない', async () => {
    setFeature(testDb, 'account-1', 'site_tracking', false);
    const app = routeApp(staff('env-owner'));

    const collect = await postCollect(app, env, 'account-1');
    // 公開口は設定状態を外へ漏らさない。204のまま、記録だけ止める。
    expect(collect.status).toBe(204);
    expect(eventCount(testDb, 'account-1')).toBe(0);
  });

  it('offは他accountへ波及しない（account-1を止めてもaccount-2は記録される）', async () => {
    setFeature(testDb, 'account-1', 'site_tracking', false);
    const app = routeApp(staff('env-owner'));

    await postCollect(app, env, 'account-1');
    await postCollect(app, env, 'account-2');
    expect(eventCount(testDb, 'account-1')).toBe(0);
    expect(eventCount(testDb, 'account-2')).toBe(1);

    const pages2 = await app.request('/api/site/pages?accountId=account-2', {}, env);
    expect(pages2.status).toBe(200);
  });

  it('off時は管理導線が403 FEATURE_DISABLEDで止まる', async () => {
    setFeature(testDb, 'account-1', 'site_tracking', false);
    const app = routeApp(staff('env-owner'));

    for (const path of [
      '/api/site/pages?accountId=account-1',
      '/api/site/tracking-key?accountId=account-1',
    ]) {
      const res = await app.request(path, {}, env);
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({
        code: 'FEATURE_DISABLED',
        featureId: 'site_tracking',
      });
    }
  });

  it('staff境界: 担当外accountの計測は読めず、担当accountの機能offで境界ごと閉じる', async () => {
    const scoped = routeApp(staff('scoped-1', 'admin'));

    // 担当外のaccount-1はmiddlewareが権限エラーで止める（存在を見せない）。
    const foreign = await scoped.request('/api/site/pages?accountId=account-1', {}, env);
    expect(foreign.status).toBe(403);
    await expect(foreign.json()).resolves.toMatchObject({ success: false });

    // 担当のaccount-2だけ機能を切っても同じ403。
    setFeature(testDb, 'account-2', 'site_tracking', false);
    const own = await scoped.request('/api/site/pages?accountId=account-2', {}, env);
    expect(own.status).toBe(403);
    await expect(own.json()).resolves.toMatchObject({ code: 'FEATURE_DISABLED' });
  });
});
