import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { featureEnforcementMiddleware } from '../middleware/feature-enforcement.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

/*
 * R352/R355: 一括承認の所属解決と対象ごとの機能確認。
 *
 * - R352: 固定アカウントのない管理者でも、画面と同じ items だけの一括承認
 *   要求が LINE_ACCOUNT_REQUIRED で止まらない（対象の成果から解決する）。
 * - R355: 別アカウントを指定した一括承認でも、各成果のアカウントで機能オフを
 *   確認する（A指定でB対象を通さない。Bオフは対象ごとに失敗として返す）。
 */

function staff(
  id: string,
  role: AuthenticatedStaff['role'] = 'owner',
  assignedLineAccountId: string | null = null,
): AuthenticatedStaff {
  return {
    id,
    name: id,
    role,
    readOnly: false,
    tenantId: DEFAULT_TENANT_ID,
    assignedLineAccountId,
  };
}

function routeApp(current: AuthenticatedStaff | undefined) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    if (current) c.set('staff', current);
    await next();
  });
  instance.use('/api/*', featureEnforcementMiddleware);
  // 判定までが対象なので、handler は受けた有効アカウントを返す stub で足りる。
  instance.post('/api/conversions/approvals/bulk', (c) => c.json({
    success: true,
    enabled: (c.get('staff') as AuthenticatedStaff | undefined)?.featureEnabledLineAccountIds ?? null,
  }));
  return instance;
}

function setFeature(testDb: SqliteD1, accountId: string, enabled: boolean): void {
  testDb.raw.prepare(`
    INSERT INTO account_settings (id, line_account_id, key, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(line_account_id, key) DO UPDATE SET value = excluded.value
  `).run(`setting-affiliates-${accountId}`, accountId, 'feature.affiliates', JSON.stringify({ enabled }));
}

function seed(testDb: SqliteD1): void {
  const now = '2026-09-22T00:00:00.000+09:00';
  for (const id of ['account-1', 'account-2']) {
    testDb.raw.prepare(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES (?, ?, ?, 'fixture', 'fixture', ?)
    `).run(id, `channel-${id}`, `店舗${id}`, DEFAULT_TENANT_ID);
    setFeature(testDb, id, true);
  }
  testDb.raw.prepare(`
    INSERT INTO conversion_points (id, name, event_type, line_account_id, created_at)
    VALUES ('cv-a', '地点A', 'purchase', 'account-1', ?),
           ('cv-b', '地点B', 'purchase', 'account-2', ?)
  `).run(now, now);
  testDb.raw.prepare(`
    INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at)
    VALUES ('ce-a', 'cv-a', 'friend-a', ?),
           ('ce-b', 'cv-b', 'friend-b', ?)
  `).run(now, now);
}

function bulkBody(ids: string[]) {
  return JSON.stringify({
    items: ids.map((id) => ({ id, status: 'approved', expectedStatus: 'pending' })),
  });
}

describe('R352/R355 一括承認の所属解決', () => {
  let testDb: SqliteD1;
  let env: Env['Bindings'];

  beforeEach(() => {
    testDb = createTestD1();
    seed(testDb);
    env = { DB: testDb.db } as Env['Bindings'];
  });

  afterEach(() => testDb.raw.close());

  it('R352: 固定アカウントのないownerでも items だけの要求が通る', async () => {
    const app = routeApp(staff('owner-1'));
    const response = await app.request('/api/conversions/approvals/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bulkBody(['ce-a']),
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, enabled: ['account-1'] });
  });

  it('R352: 複数アカウントの対象も解決して通る', async () => {
    const app = routeApp(staff('owner-1'));
    const response = await app.request('/api/conversions/approvals/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bulkBody(['ce-a', 'ce-b']),
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      enabled: ['account-1', 'account-2'],
    });
  });

  it('R355: 別アカウント指定で対象外の成果は明示拒否になる', async () => {
    const app = routeApp(staff('owner-1'));
    const response = await app.request('/api/conversions/approvals/bulk?account_id=account-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bulkBody(['ce-b']),
    }, env);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'LINE_ACCOUNT_MISMATCH' });
  });

  it('R355: 機能オフの対象が混ざっても許可分は通しオフ分を対象外にできる', async () => {
    setFeature(testDb, 'account-2', false);
    const app = routeApp(staff('owner-1'));
    const response = await app.request('/api/conversions/approvals/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bulkBody(['ce-a', 'ce-b']),
    }, env);
    // 入口で全体を落とさず、有効な account-1 だけを handler へ渡す。
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, enabled: ['account-1'] });
  });

  it('R355: 対象すべてが機能オフなら全体を止める', async () => {
    setFeature(testDb, 'account-2', false);
    const app = routeApp(staff('owner-1'));
    const response = await app.request('/api/conversions/approvals/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bulkBody(['ce-b']),
    }, env);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'FEATURE_DISABLED' });
  });
});
