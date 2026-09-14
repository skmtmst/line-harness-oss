/*
 * 管理者確認専用口 GET /api/forms/unassigned(#724)。
 *
 * 実DB・実権限で見る。DBモックでは「誰が見られるか」自体を差し替えられて
 * しまい、この口の存在理由（権限の絞り）を何も見張れないため。
 * 通常一覧へ未割当が混ざらないこともここで見る。
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { forms } from './forms.js';

const OTHER_TENANT = 'other-tenant-724';

function staff(
  id: string,
  role: AuthenticatedStaff['role'],
  tenantId?: string | null,
  featureEnabledLineAccountIds?: string[],
): AuthenticatedStaff {
  return { id, name: id, role, readOnly: false, tenantId, featureEnabledLineAccountIds };
}

function app(current: AuthenticatedStaff | null) {
  const instance = new Hono<Env>();
  if (current) {
    instance.use('*', async (c, next) => {
      c.set('staff', current);
      await next();
    });
  }
  instance.route('/', forms);
  return instance;
}

function seed(testDb: SqliteD1): void {
  const raw = testDb.raw;
  raw.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('${DEFAULT_TENANT_ID}', '既定'), ('${OTHER_TENANT}', '別')`).run();
  raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('acc-a', 'channel-a', 'A店', 'token', 'secret', 1, '${DEFAULT_TENANT_ID}'),
            ('acc-b', 'channel-b', 'B店', 'token', 'secret', 1, '${OTHER_TENANT}')`,
  ).run();
  raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', 'owner-1', 'owner', 'key-1', '${DEFAULT_TENANT_ID}', 'all'),
            ('admin-1', 'admin-1', 'admin', 'key-2', '${DEFAULT_TENANT_ID}', 'all'),
            ('staff-1', 'staff-1', 'staff', 'key-3', '${DEFAULT_TENANT_ID}', 'all'),
            ('scoped-1', 'scoped-1', 'owner', 'key-4', '${DEFAULT_TENANT_ID}', 'accounts'),
            ('owner-x', 'owner-x', 'owner', 'key-5', '${OTHER_TENANT}', 'all')`,
  ).run();
  raw.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at) VALUES ('scoped-1', 'acc-a', '2026-09-01T00:00:00+09:00')`,
  ).run();
  raw.prepare(
    `INSERT INTO forms (id, name) VALUES ('form-assigned', '割当済み'), ('form-legacy', '旧フォーム要確認')`,
  ).run();
  raw.prepare(`INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-assigned', 'acc-a')`).run();
}

type ListBody = { success: boolean; data: Array<{ id: string; accountScopeReviewRequired: boolean }> };

async function get(testDb: SqliteD1, current: AuthenticatedStaff | null, path: string) {
  const response = await app(current).request(path, {}, { DB: testDb.db } as Env['Bindings']);
  return response;
}

describe('GET /api/forms/unassigned(#724)', () => {
  it('既定テナントのowner/adminだけが未割当だけを確認できる', async () => {
    const testDb = createTestD1();
    seed(testDb);

    for (const current of [staff('owner-1', 'owner', DEFAULT_TENANT_ID), staff('admin-1', 'admin', DEFAULT_TENANT_ID)]) {
      const response = await get(testDb, current, '/api/forms/unassigned?account_id=acc-a');
      expect(response.status).toBe(200);
      const body = (await response.json()) as ListBody;
      expect(body.data.map((item) => item.id)).toEqual(['form-legacy']);
      expect(body.data[0]?.accountScopeReviewRequired).toBe(true);
    }
  });

  it('環境ownerは見られる', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const response = await get(testDb, staff('env-owner', 'owner'), '/api/forms/unassigned?account_id=acc-a');
    expect(response.status).toBe(200);
    expect(((await response.json()) as ListBody).data.map((item) => item.id)).toEqual(['form-legacy']);
  });

  it('account_idが無いと400', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const response = await get(testDb, staff('owner-1', 'owner', DEFAULT_TENANT_ID), '/api/forms/unassigned');
    expect(response.status).toBe(400);
  });

  it('staff・制限付き・機能スコープ付き・別テナント・未認証・範囲外アカウントは確認できない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const denied: Array<{ current: AuthenticatedStaff | null; path: string }> = [
      { current: staff('staff-1', 'staff', DEFAULT_TENANT_ID), path: '/api/forms/unassigned?account_id=acc-a' },
      { current: staff('scoped-1', 'owner', DEFAULT_TENANT_ID), path: '/api/forms/unassigned?account_id=acc-a' },
      { current: staff('owner-1', 'owner', DEFAULT_TENANT_ID, ['acc-a']), path: '/api/forms/unassigned?account_id=acc-a' },
      { current: staff('owner-x', 'owner', OTHER_TENANT), path: '/api/forms/unassigned?account_id=acc-b' },
      { current: null, path: '/api/forms/unassigned?account_id=acc-a' },
      { current: staff('owner-1', 'owner', DEFAULT_TENANT_ID), path: '/api/forms/unassigned?account_id=acc-b' },
    ];
    for (const { current, path } of denied) {
      const response = await get(testDb, current, path);
      expect(response.status).not.toBe(200);
    }
  });

  it('通常のアカウント別一覧へ未割当は混ざらない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const response = await get(testDb, staff('owner-1', 'owner', DEFAULT_TENANT_ID), '/api/forms?account_id=acc-a');
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListBody;
    expect(body.data.map((item) => item.id)).toEqual(['form-assigned']);
  });
});
