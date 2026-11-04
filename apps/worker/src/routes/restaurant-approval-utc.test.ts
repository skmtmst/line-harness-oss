import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { seedRestaurantFixture } from '../test-utils/restaurant-fixture.js';

const mocks = vi.hoisted(() => ({ accounts: [] as Array<Record<string, unknown>> }));
vi.mock('@line-crm/db', async () => ({
  ...await vi.importActual<typeof import('@line-crm/db')>('@line-crm/db'),
  getPlatformSetting: async () => 'false',
  getStaffByApiKey: async () => null,
  getStaffByAdminSession: async () => null,
  getLineAccounts: async () => mocks.accounts,
  getLineAccountScopeEntries: async () => mocks.accounts,
}));
const { authMiddleware } = await import('../middleware/auth.js');
const { restaurantTest } = await import('./restaurant-test.js');
type Env = import('../index.js').Env;

it('承認一覧の申請日時は旧 UTC の時差を明示して返す', async () => {
  const db = createTestD1({ loginPolicy: 'off' });
  db.raw.exec(readFileSync(new URL('../../../../packages/db/migrations/168_restaurant_test_foundation.sql', import.meta.url), 'utf8'));
  db.raw.exec(readFileSync(new URL('../../../../packages/db/migrations/175_restaurant_terms_agreement.sql', import.meta.url), 'utf8'));
  mocks.accounts = ['account-1', 'account-2', 'account-3', 'account-4'].map(id => ({ id, name: id, is_active: 1, channel_access_token: 'token' }));
  seedRestaurantFixture(db);
  db.raw.exec(`INSERT INTO rt_approval_requests(id,organization_id,store_id,kind,title,status,created_at,updated_at)
    VALUES('utc','org-fixture','store-ginza','menu_change','申請','pending','2026-10-01 17:00:00','2026-10-01 17:05:00')`);
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', restaurantTest);
  const env = { DB: db.db, API_KEY: 'owner-key', DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true' } as Env['Bindings'];
  const response = await app.request('/api/restaurant-test/snapshot?account_id=account-1', { headers: { Authorization: 'Bearer owner-key' } }, env);
  expect(response.status).toBe(200);
  const json = await response.json() as { data: { approvals: Array<{id: string; created_at: string; updated_at: string}> } };
  expect(json.data.approvals.find(row => row.id === 'utc')).toMatchObject({ created_at: '2026-10-01T17:00:00Z', updated_at: '2026-10-01T17:05:00Z' });
  db.raw.close();
});
