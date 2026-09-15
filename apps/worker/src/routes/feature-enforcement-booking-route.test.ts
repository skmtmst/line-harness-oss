import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { featureEnforcementMiddleware } from '../middleware/feature-enforcement.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import booking from './booking.js';

const staff: AuthenticatedStaff = {
  id: 'env-owner',
  name: 'オーナー',
  role: 'owner',
  readOnly: false,
  tenantId: DEFAULT_TENANT_ID,
};

function routeApp() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', staff);
    await next();
  });
  instance.use('/api/*', featureEnforcementMiddleware);
  instance.route('/', booking);
  return instance;
}

function setFeature(testDb: SqliteD1, featureId: string, enabled: boolean): void {
  testDb.raw.prepare(`
    INSERT INTO account_settings (id, line_account_id, key, value)
    VALUES (?, 'account-1', ?, ?)
    ON CONFLICT(line_account_id, key) DO UPDATE SET value = excluded.value
  `).run(`setting-${featureId}`, `feature.${featureId}`, JSON.stringify({ enabled }));
}

describe('予約台帳routeの機能停止境界', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES ('account-1', 'channel-1', '店舗', 'fixture', 'fixture', ?)
    `).run(DEFAULT_TENANT_ID);
  });

  afterEach(() => testDb.raw.close());

  it('旧reservation_ledgerがオンでもbookingがオフなら拒否し、booking復帰後は実routeを読める', async () => {
    setFeature(testDb, 'reservation_ledger', true);
    setFeature(testDb, 'booking', false);

    const disabled = await routeApp().request(
      '/api/booking/admin/requests?account_id=account-1&status=all',
      {},
      { DB: testDb.db },
    );
    expect(disabled.status).toBe(403);
    await expect(disabled.json()).resolves.toMatchObject({
      success: false,
      code: 'FEATURE_DISABLED',
      featureId: 'booking',
      reason: 'company_disabled',
    });

    setFeature(testDb, 'booking', true);
    const enabled = await routeApp().request(
      '/api/booking/admin/requests?account_id=account-1&status=all',
      {},
      { DB: testDb.db },
    );
    expect(enabled.status).toBe(200);
    await expect(enabled.json()).resolves.toMatchObject({ requests: [], total: 0 });
  });
});
