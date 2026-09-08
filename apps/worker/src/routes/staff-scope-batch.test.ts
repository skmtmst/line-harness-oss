import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

// スタッフ一覧の担当範囲 N+1 解消(#515 中1)。
// 一覧では IN で一括取得し、1人ずつの getStaffAccountScopeIds を叩かない。
const dbMocks = vi.hoisted(() => ({
  getStaffMembers: vi.fn(),
  getStaffById: vi.fn(),
  getStaffByInviteTokenHash: vi.fn(),
  createStaffMember: vi.fn(),
  updateStaffMember: vi.fn(),
  deleteStaffMember: vi.fn(),
  countLoginAudit: vi.fn(),
  getStaffAccountScopeIds: vi.fn(),
  getStaffAccountScopeMap: vi.fn(),
  replaceStaffAccountScopes: vi.fn(),
  revokeStaffAuthentication: vi.fn(),
  getLineAccounts: vi.fn().mockResolvedValue([]),
}));

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('../services/staff-invite.js', () => ({
  sendStaffInviteEmail: vi.fn(),
  sendStaffLineLinkEmail: vi.fn(),
}));

const { staff } = await import('./staff.js');

const DB = {} as D1Database;

function row(id: string, accountScope: 'all' | 'accounts' = 'accounts') {
  return {
    id, name: id, email: `${id}@example.test`, role: 'admin', access_level: 'full',
    is_active: 1, line_user_id: null, permission_keys: '[]', notification_preferences: '{}',
    invite_status: 'active', policy_version: 1, created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00', assigned_line_account_id: null,
    can_access_descendant_accounts: 0, account_scope: accountScope, tenant_id: 'tenant-1',
  };
}

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'owner-1', name: '管理者', role: 'owner', readOnly: false,
      tenantId: 'tenant-1', permissionKeys: [],
    });
    await next();
  });
  instance.route('/', staff);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getStaffMembers.mockResolvedValue([row('a'), row('b'), row('c')]);
  dbMocks.getStaffAccountScopeMap.mockResolvedValue(new Map([
    ['a', ['account-1']],
    ['b', ['account-1', 'account-2']],
    ['c', []],
  ]));
});

describe('staff list scope batching', () => {
  it('reads scopes in one batch instead of per member', async () => {
    const response = await app().fetch(
      new Request('https://example.com/api/staff'),
      { DB } as Env['Bindings'],
    );
    expect(response.status).toBe(200);
    expect(dbMocks.getStaffAccountScopeMap).toHaveBeenCalledTimes(1);
    expect(dbMocks.getStaffAccountScopeIds).not.toHaveBeenCalled();
    const body = await response.json() as { data: Array<{ id: string; scopedLineAccountIds: string[] }> };
    expect(body.data.map((member) => [
      member.id, member.scopedLineAccountIds,
    ])).toEqual([
      ['a', ['account-1']],
      ['b', ['account-1', 'account-2']],
      ['c', []],
    ]);
  });
});
