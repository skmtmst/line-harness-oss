import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

/*
 * M958の同時作成の窓。確認（重複なし）→挿入の間に割り込んだ招待は
 * 一意制約で弾かれ、負けた側は500ではなく409で送り直しへ案内する。
 * 実DBでは再現が非決定的なので、制約違反の受け口だけを模擬で確かめる。
 */
const dbMocks = vi.hoisted(() => ({
  getStaffMembers: vi.fn().mockResolvedValue([]),
  getStaffById: vi.fn(),
  getStaffByInviteTokenHash: vi.fn(),
  createStaffMemberWithScopes: vi.fn(),
  updateStaffMember: vi.fn(),
  deleteStaffMemberWithScopes: vi.fn(),
  countLoginAudit: vi.fn(),
  getStaffAccountScopeIds: vi.fn(),
  getStaffAccountScopeMap: vi.fn().mockResolvedValue(new Map()),
  replaceStaffAccountScopes: vi.fn(),
  revokeStaffAuthentication: vi.fn(),
  getLineAccounts: vi.fn().mockResolvedValue([]),
}));
vi.mock('@line-crm/db', () => dbMocks);

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: vi.fn().mockResolvedValue({
    accounts: [{ id: 'account-1' }],
    allowedAccountIds: ['account-1'],
  }),
}));

const mail = vi.hoisted(() => ({
  sendStaffInviteEmail: vi.fn(),
  sendStaffLineLinkEmail: vi.fn(),
}));
vi.mock('../services/staff-invite.js', () => mail);

const { staff } = await import('./staff.js');

const DB = {} as D1Database;

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
  dbMocks.getStaffMembers.mockResolvedValue([]);
});

describe('M958 同時作成の負け側', () => {
  it('一意制約に当たったら500ではなく409で送り直しへ案内する', async () => {
    dbMocks.createStaffMemberWithScopes.mockRejectedValueOnce(
      new Error('UNIQUE constraint failed: staff_members.tenant_id, staff_members.email'),
    );
    const response = await app().request('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '同時招待', email: 'race@example.test', role: 'staff',
        assignedLineAccountId: 'account-1',
        accountScope: 'accounts', scopedLineAccountIds: ['account-1'],
      }),
    }, { DB } as Env['Bindings']);
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('招待中');
    expect(mail.sendStaffInviteEmail).not.toHaveBeenCalled();
  });

  it('制約以外の書き込み失敗は500で後片付けへ回す', async () => {
    dbMocks.createStaffMemberWithScopes.mockRejectedValueOnce(new Error('connection lost'));
    const response = await app().request('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '同時招待', email: 'other@example.test', role: 'staff',
        assignedLineAccountId: 'account-1',
        accountScope: 'accounts', scopedLineAccountIds: ['account-1'],
      }),
    }, { DB } as Env['Bindings']);
    expect(response.status).toBe(500);
  });
});
