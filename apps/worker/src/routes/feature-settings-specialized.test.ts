import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { tenantScopeMiddleware } from '../middleware/tenant-scope.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  featureSettings,
  NEN_SPECIALIZED_FEATURES,
  specializedCatalog,
} from './feature-settings.js';

let testDb: SqliteD1;
let warn: ReturnType<typeof vi.spyOn>;

const operator: AuthenticatedStaff = {
  id: 'operator-owner',
  name: '運営オーナー',
  role: 'owner',
  readOnly: false,
  tenantId: DEFAULT_TENANT_ID,
};

function app(staff: AuthenticatedStaff = operator) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', staff);
    return next();
  });
  instance.use('*', tenantScopeMiddleware);
  instance.route('/', featureSettings);
  return instance;
}

function environment(): Env['Bindings'] {
  return { DB: testDb.db } as Env['Bindings'];
}

function insertAccount(id: string, tenantId: string): void {
  testDb.raw.prepare(`INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
      id, `channel-${id}`, id, `token-${id}`, `secret-${id}`, tenantId,
    );
}

async function putCatalog(catalog: unknown, staff: AuthenticatedStaff = operator) {
  return app(staff).request('/api/settings/features?account_id=default-account', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ catalog }),
  }, environment());
}

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  testDb = createTestD1();
  insertAccount('default-account', DEFAULT_TENANT_ID);
  insertAccount('other-account', 'other-tenant');
});

afterEach(() => {
  warn.mockRestore();
  testDb.raw.close();
});

describe('専用機能目録 API', () => {
  it('運営が保存した目録を既存GETから取得できる', async () => {
    expect((await putCatalog(['nen_campaigns'])).status).toBe(200);

    const response = await app().request(
      '/api/settings/features?account_id=default-account', {}, environment(),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { specializedFeatureKeys: string[] } };
    expect(body.data.specializedFeatureKeys).toEqual(['nen_campaigns']);
  });

  it('空配列を保存できる', async () => {
    expect((await putCatalog([])).status).toBe(200);
    expect(testDb.raw.prepare(
      "SELECT value FROM account_settings WHERE line_account_id = ? AND key = 'feature.specialized.catalog'",
    ).get('default-account')).toEqual({ value: '[]' });
  });

  it('同じ内容を2回保存しても保存行と値が変わらない', async () => {
    expect((await putCatalog(['nen_campaigns'])).status).toBe(200);
    expect((await putCatalog(['nen_campaigns'])).status).toBe(200);
    expect(testDb.raw.prepare(
      "SELECT COUNT(*) AS count, value FROM account_settings WHERE line_account_id = ? AND key = 'feature.specialized.catalog'",
    ).get('default-account')).toEqual({ count: 1, value: '["nen_campaigns"]' });
  });

  it.each([
    { catalog: 'nen_campaigns', label: '配列でない値' },
    { catalog: ['restaurant_test'], label: '飲食店テスト' },
    { catalog: ['unknown_feature'], label: '知らない文字列' },
  ])('$labelを400にする', async ({ catalog }) => {
    expect((await putCatalog(catalog)).status).toBe(400);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM account_settings').get())
      .toEqual({ count: 0 });
  });

  it('account_idが無ければ400にする', async () => {
    const response = await app().request('/api/settings/features', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalog: [] }),
    }, environment());
    expect(response.status).toBe(400);
  });

  it.each([
    { role: 'owner' as const, readOnly: false, tenantId: 'other-tenant', label: '既定統括でないowner' },
    { role: 'admin' as const, readOnly: false, tenantId: DEFAULT_TENANT_ID, label: 'admin' },
    { role: 'owner' as const, readOnly: true, tenantId: DEFAULT_TENANT_ID, label: 'read_only' },
  ])('$labelを403にする', async ({ role, readOnly, tenantId }) => {
    const response = await putCatalog([], { ...operator, role, readOnly, tenantId });
    expect(response.status).toBe(403);
  });

  it('範囲外のaccount_idをtenantScopeMiddlewareで403にする', async () => {
    const response = await app().request('/api/settings/features?account_id=other-account', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalog: [] }),
    }, environment());
    expect(response.status).toBe(403);
  });

  it('未保存時の既定は然向け4キーのまま', () => {
    expect(NEN_SPECIALIZED_FEATURES).toEqual([
      'nen_campaigns', 'photo_review', 'ec_commerce', 'line_notifications',
    ]);
    expect(specializedCatalog(null)).toEqual(NEN_SPECIALIZED_FEATURES);
  });
});
