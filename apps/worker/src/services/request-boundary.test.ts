import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { resolveRequestBoundaries, resolveRequestBoundary } from './request-boundary.js';

// board #800: 権限・tenant・LINEアカウント境界の共通土台。
// 実SQLiteで確かめる。SQLそのものが仕様のため、手書きモックでは意味がない。

const TENANT_B = 'tenant-B';
const NOW = '2026-09-14T00:00:00+09:00';

function staff(
  id: string,
  tenantId: string | null,
  options: { permissionKeys?: string[]; readOnly?: boolean } = {},
): AuthenticatedStaff {
  return {
    id, name: id, role: 'owner', readOnly: options.readOnly ?? false,
    permissionKeys: options.permissionKeys, tenantId,
  } as AuthenticatedStaff;
}

function seed(testDb: SqliteD1): void {
  testDb.raw.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES (?, '既定統括'), (?, '支社')`)
    .run(DEFAULT_TENANT_ID, TENANT_B);
  for (const [id, tenant] of [['acc-1', DEFAULT_TENANT_ID], ['acc-2', DEFAULT_TENANT_ID], ['acc-b', TENANT_B]] as const) {
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 1, ?)`,
    ).run(id, `channel-${id}`, id, tenant);
  }
  testDb.raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', 'owner-1', 'owner', 'key-1', ?, 'all'),
            ('scoped-1', 'scoped-1', 'staff', 'key-2', ?, 'accounts'),
            ('b-1', 'b-1', 'admin', 'key-3', ?, 'all')`,
  ).run(DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, TENANT_B);
  testDb.raw.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at) VALUES ('scoped-1', 'acc-1', ?)`,
  ).run(NOW);
}

describe('request-boundary', () => {
  it('未認証は常に不許可で理由はunauthenticated', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const decision = await resolveRequestBoundary(testDb.db, undefined, 'acc-1');
    expect(decision).toEqual({
      allowed: false,
      reason: 'unauthenticated',
      scope: { accounts: [], allowedAccountIds: [], canSeeUnassigned: false, ids: [], isAccountScoped: true },
    });
  });

  it('既定統括のownerは自統括のアカウント指定を許可する', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const decision = await resolveRequestBoundary(testDb.db, staff('owner-1', DEFAULT_TENANT_ID), 'acc-2');
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.scope.allowedAccountIds).toEqual(['acc-1', 'acc-2']);
    }
  });

  it('指定なしは一覧用に許可し、絞り込み用の範囲を返す', async () => {
    const testDb = createTestD1();
    seed(testDb);
    for (const requested of [undefined, ''] as const) {
      const decision = await resolveRequestBoundary(testDb.db, staff('owner-1', DEFAULT_TENANT_ID), requested);
      expect(decision.allowed).toBe(true);
    }
  });

  it('別統括のアカウント指定は不許可で理由はoutside-scope', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const denied = await resolveRequestBoundary(testDb.db, staff('b-1', TENANT_B), 'acc-1');
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.reason).toBe('outside-scope');
    const allowed = await resolveRequestBoundary(testDb.db, staff('b-1', TENANT_B), 'acc-b');
    expect(allowed.allowed).toBe(true);
  });

  it('個別範囲のstaffは割当外のアカウントを指定できない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const me = staff('scoped-1', DEFAULT_TENANT_ID);
    expect((await resolveRequestBoundary(testDb.db, me, 'acc-1')).allowed).toBe(true);
    const denied = await resolveRequestBoundary(testDb.db, me, 'acc-2');
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.reason).toBe('outside-scope');
  });

  it('未割当(null)の参照は既定統括だけが許可される', async () => {
    const testDb = createTestD1();
    seed(testDb);
    expect((await resolveRequestBoundary(testDb.db, staff('owner-1', DEFAULT_TENANT_ID), null)).allowed).toBe(true);
    expect((await resolveRequestBoundary(testDb.db, staff('b-1', TENANT_B), null)).allowed).toBe(false);
  });

  it('存在しないIDの指定は不許可', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const decision = await resolveRequestBoundary(testDb.db, staff('owner-1', DEFAULT_TENANT_ID), 'no-such-account');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('outside-scope');
  });

  it('必須キー持ちは許可し、キーなし・部分一致は不許可', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const key = { requiredPermissionKey: 'forms.edit' };
    const withKey = staff('owner-1', DEFAULT_TENANT_ID, { permissionKeys: ['forms.edit'] });
    expect((await resolveRequestBoundary(testDb.db, withKey, 'acc-1', key)).allowed).toBe(true);
    const withoutKey = staff('owner-1', DEFAULT_TENANT_ID, { permissionKeys: ['forms.view'] });
    const denied = await resolveRequestBoundary(testDb.db, withoutKey, 'acc-1', key);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.reason).toBe('forbidden');
    // 部分一致は許可しない。「forms.edit.all」持ちで「forms.edit」要求は通さない。
    const broader = staff('owner-1', DEFAULT_TENANT_ID, { permissionKeys: ['forms.edit.all'] });
    expect((await resolveRequestBoundary(testDb.db, broader, 'acc-1', key)).allowed).toBe(false);
    // 逆(狭い持ちで広い要求)も通さない。
    const narrower = staff('owner-1', DEFAULT_TENANT_ID, { permissionKeys: ['forms'] });
    expect((await resolveRequestBoundary(testDb.db, narrower, 'acc-1', key)).allowed).toBe(false);
  });

  it('readOnlyはキー持ちでも必須キー要求で不許可', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const reader = staff('owner-1', DEFAULT_TENANT_ID, { permissionKeys: ['forms.edit'], readOnly: true });
    const decision = await resolveRequestBoundary(
      testDb.db, reader, 'acc-1', { requiredPermissionKey: 'forms.edit' },
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('forbidden');
  });

  it('複数IDは全て範囲内なら許可、1件でも範囲外なら不許可', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const me = staff('owner-1', DEFAULT_TENANT_ID);
    expect((await resolveRequestBoundaries(testDb.db, me, ['acc-1', 'acc-2'])).allowed).toBe(true);
    const denied = await resolveRequestBoundaries(testDb.db, me, ['acc-1', 'acc-b']);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.reason).toBe('outside-scope');
    // 個別範囲のstaffは割当だけ通る。
    const scoped = staff('scoped-1', DEFAULT_TENANT_ID);
    expect((await resolveRequestBoundaries(testDb.db, scoped, ['acc-1'])).allowed).toBe(true);
    expect((await resolveRequestBoundaries(testDb.db, scoped, ['acc-1', 'acc-2'])).allowed).toBe(false);
  });

  it('複数IDのnullは未割当可視のときだけ通る', async () => {
    const testDb = createTestD1();
    seed(testDb);
    expect((await resolveRequestBoundaries(
      testDb.db, staff('owner-1', DEFAULT_TENANT_ID), ['acc-1', null],
    )).allowed).toBe(true);
    expect((await resolveRequestBoundaries(
      testDb.db, staff('b-1', TENANT_B), ['acc-b', null],
    )).allowed).toBe(false);
  });
});
