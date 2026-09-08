import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

// 権限キーと通知設定の検証(#515 中3)。DBに触れる前に400で断つ。
const dbMocks = vi.hoisted(() => ({
  getStaffMembers: vi.fn().mockResolvedValue([]),
  getStaffById: vi.fn(),
  getStaffByInviteTokenHash: vi.fn(),
  createStaffMember: vi.fn(),
  updateStaffMember: vi.fn(),
  deleteStaffMember: vi.fn(),
  countLoginAudit: vi.fn(),
  getStaffAccountScopeIds: vi.fn(),
  getStaffAccountScopeMap: vi.fn().mockResolvedValue(new Map()),
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

function post(body: unknown) {
  return app().fetch(new Request('https://example.com/api/staff', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), { DB } as Env['Bindings']);
}

function patch(body: unknown) {
  return app().fetch(new Request('https://example.com/api/staff/member-1', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), { DB } as Env['Bindings']);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getStaffById.mockResolvedValue(null);
});

describe('staff permission and notification validation', () => {
  it('rejects permission keys with unusable characters before touching the DB', async () => {
    const response = await post({ permissionKeys: ['/chats', '<script>alert(1)</script>'] });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('使えない文字');
    expect(dbMocks.getStaffMembers).not.toHaveBeenCalled();
  });

  it('rejects unknown notification kinds before touching the DB', async () => {
    const response = await post({ notificationPreferences: { weather: { email: true, line: false } } });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('ない種類');
  });

  it('rejects non-boolean notification channels', async () => {
    const response = await patch({ notificationPreferences: { operations: { email: 'yes', line: false } } });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('オン・オフ');
    expect(dbMocks.getStaffById).not.toHaveBeenCalled();
  });

  it('rejects bad keys on update as well', async () => {
    const response = await patch({ permissionKeys: 'not-an-array' });
    expect(response.status).toBe(400);
    expect(dbMocks.getStaffById).not.toHaveBeenCalled();
  });

  it('lets well-formed keys through validation', async () => {
    // 後の必須項目不足で止まることが、検証を通過した証拠。
    const response = await post({
      name: '新人', email: 'newcomer@example.test', role: 'staff',
      permissionKeys: ['/chats', 'ec.event.view'],
      notificationPreferences: { operations: { email: true, line: false } },
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('担当範囲を選んでください');
  });
});
