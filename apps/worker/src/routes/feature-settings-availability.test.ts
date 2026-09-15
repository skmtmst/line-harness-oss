import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const access = vi.hoisted(() => ({ canAccess: vi.fn(async () => true) }));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: access.canAccess,
}));

const { featureSettings } = await import('./feature-settings.js');

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'owner', name: 'Owner', role: 'owner', readOnly: false,
      tenantId: DEFAULT_TENANT_ID,
    });
    await next();
  });
  instance.route('/', featureSettings);
  return instance;
}

function fixture(planStatus: 'active' | 'canceled' = 'active'): SqliteD1 {
  const testDb = createTestD1();
  testDb.raw.prepare('UPDATE tenants SET plan_key = ?, plan_status = ? WHERE id = ?')
    .run('standard', planStatus, DEFAULT_TENANT_ID);
  testDb.raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('account-1', 'channel-1', '店舗', 'fixture', 'fixture', DEFAULT_TENANT_ID);
  return testDb;
}

function setLegacy(testDb: SqliteD1, featureId: string, enabled: boolean) {
  testDb.raw.prepare(`
    INSERT INTO account_settings (id, line_account_id, key, value)
    VALUES (?, 'account-1', ?, ?)
    ON CONFLICT(line_account_id, key) DO UPDATE SET value = excluded.value
  `).run(`setting-${featureId}`, `feature.${featureId}`, JSON.stringify({ enabled }));
}

async function load(testDb: SqliteD1) {
  const response = await app().request(
    '/api/settings/features?account_id=account-1',
    {},
    { DB: testDb.db, RESTAURANT_TEST_ENABLED: 'true' },
  );
  expect(response.status).toBe(200);
  return response.json<{
    data: {
      features: Record<string, boolean>;
      featureStates: Record<string, {
        contractAvailable: boolean;
        companyEnabled: boolean;
        dependenciesEnabled: boolean;
        effectiveEnabled: boolean;
        reason: string | null;
        message: string | null;
        disabledDependencies: string[];
      }>;
    };
  }>();
}

beforeEach(() => {
  vi.clearAllMocks();
  access.canAccess.mockResolvedValue(true);
});

describe('GET /api/settings/features availability', () => {
  it('契約対象外と会社設定を分け、既存boolean応答を変えない', async () => {
    const testDb = fixture('canceled');
    try {
      setLegacy(testDb, 'broadcasts', true);
      const body = await load(testDb);

      expect(body.data.features.broadcasts).toBe(true);
      expect(body.data.featureStates.broadcasts).toMatchObject({
        contractAvailable: false,
        companyEnabled: true,
        dependenciesEnabled: true,
        effectiveEnabled: false,
        reason: 'contract_unavailable',
      });
      expect(body.data.featureStates.broadcasts.message).toContain('契約');
    } finally {
      testDb.raw.close();
    }
  });

  it('会社設定offをcompany_disabledとして返す', async () => {
    const testDb = fixture();
    try {
      setLegacy(testDb, 'scenarios', false);
      const body = await load(testDb);
      expect(body.data.featureStates.scenarios).toMatchObject({
        contractAvailable: true,
        companyEnabled: false,
        effectiveEnabled: false,
        reason: 'company_disabled',
      });
    } finally {
      testDb.raw.close();
    }
  });

  it('依存先offで子だけ実効offになり、復帰しても子の会社設定を失わない', async () => {
    const testDb = fixture();
    try {
      setLegacy(testDb, 'multi_store_bulk_updates', true);
      setLegacy(testDb, 'multi_store_hierarchy', false);

      const disabled = await load(testDb);
      expect(disabled.data.featureStates.multi_store_bulk_updates).toMatchObject({
        companyEnabled: true,
        dependenciesEnabled: false,
        effectiveEnabled: false,
        reason: 'dependency_disabled',
        disabledDependencies: ['multi_store_hierarchy'],
      });

      setLegacy(testDb, 'multi_store_hierarchy', true);
      const recovered = await load(testDb);
      expect(recovered.data.features.multi_store_bulk_updates).toBe(true);
      expect(recovered.data.featureStates.multi_store_bulk_updates).toMatchObject({
        companyEnabled: true,
        dependenciesEnabled: true,
        effectiveEnabled: true,
        reason: null,
      });
    } finally {
      testDb.raw.close();
    }
  });

  it('契約・会社設定・依存が有効ならenabledを返す', async () => {
    const testDb = fixture();
    try {
      setLegacy(testDb, 'multi_store_hierarchy', true);
      setLegacy(testDb, 'multi_store_bulk_updates', true);
      const body = await load(testDb);
      expect(body.data.featureStates.multi_store_bulk_updates).toEqual({
        featureId: 'multi_store_bulk_updates',
        contractAvailable: true,
        companyEnabled: true,
        dependenciesEnabled: true,
        effectiveEnabled: true,
        reason: null,
        message: null,
        disabledDependencies: [],
      });
    } finally {
      testDb.raw.close();
    }
  });
});
