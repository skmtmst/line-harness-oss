import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { sha256Hex } from '../middleware/auth.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

/*
 * N-425/N-432(#668)。期限切れ招待の再送と7日期限の契約試験。
 * 実D1で通し、旧トークンの失効・2回目の保存・境界を確かめる。
 */
const mail = vi.hoisted(() => ({
  sendStaffInviteEmail: vi.fn(),
  sendStaffLineLinkEmail: vi.fn(),
}));
vi.mock('../services/staff-invite.js', () => mail);

const { staff } = await import('./staff.js');

const NOW = '2026-09-08T01:00:00.000Z';
const OLD_TOKEN = 'expired-invite-token';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
let testDb: ReturnType<typeof createTestD1>;

function app(role: 'owner' | 'admin' | 'staff' = 'admin') {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'env-owner', name: '管理者', role, readOnly: false,
      permissionKeys: [],
    });
    await next();
  });
  instance.route('/', staff);
  return instance;
}

function bindings(): Env['Bindings'] {
  return {
    DB: testDb.db,
    ADMIN_PUBLIC_URL: 'https://admin.example.com',
  } as Env['Bindings'];
}

function inviteeRow(id: string): { invite_token_hash: string | null; invite_expires_at: string | null; invite_status: string } {
  return testDb.raw.prepare(
    'SELECT invite_token_hash, invite_expires_at, invite_status FROM staff_members WHERE id = ?',
  ).get(id) as { invite_token_hash: string | null; invite_expires_at: string | null; invite_status: string };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  testDb = createTestD1();
  mail.sendStaffInviteEmail.mockReset();
  mail.sendStaffLineLinkEmail.mockReset();
  mail.sendStaffInviteEmail.mockResolvedValue(undefined);
  mail.sendStaffLineLinkEmail.mockResolvedValue(undefined);
});

afterEach(() => {
  testDb.raw.close();
  vi.useRealTimers();
});

describe('招待の再送 (N-425)', () => {
  beforeEach(async () => {
    testDb.raw.prepare(
      `INSERT INTO staff_members
         (id, name, email, role, api_key, is_active, invite_status, invite_token_hash, invite_expires_at)
       VALUES (?, ?, ?, 'staff', ?, 0, 'pending_email', ?, ?)`,
    ).run(
      'invitee-1', '招待された人', 'invitee@example.test', 'invitee-key',
      await sha256Hex(OLD_TOKEN), new Date(Date.now() - 60_000).toISOString(),
    );
  });

  async function resend(id = 'invitee-1', role: 'owner' | 'admin' | 'staff' = 'admin') {
    return app(role).request(`/api/staff/${id}/resend-invitation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    }, bindings());
  }

  it('期限切れの招待を送り直せる。同じ行を使い回し、期限は7日になる', async () => {
    const response = await resend();
    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; data: { id: string; inviteStatus: string; inviteExpiresAt: string } };
    expect(body.data.id).toBe('invitee-1');
    expect(body.data.inviteStatus).toBe('pending_email');
    expect(body.data.inviteExpiresAt).toBe(new Date(Date.now() + SEVEN_DAYS_MS).toISOString());

    const row = inviteeRow('invitee-1');
    expect(row.invite_status).toBe('pending_email');
    expect(row.invite_expires_at).toBe(new Date(Date.now() + SEVEN_DAYS_MS).toISOString());
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM staff_members').get()).toEqual({ count: 1 });
    expect(mail.sendStaffInviteEmail).toHaveBeenCalledOnce();
  });

  it('送り直したリンクで受諾を続けられる', async () => {
    expect((await resend()).status).toBe(200);
    const verifyUrl = mail.sendStaffInviteEmail.mock.calls[0][1].verifyUrl as string;
    const token = verifyUrl.split('#invite=')[1];
    expect(token?.length).toBeGreaterThan(10);

    const confirm = await app().request('/api/staff/invitations/confirm/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
    }, bindings());
    expect(confirm.status).toBe(200);
    expect(inviteeRow('invitee-1').invite_status).toBe('pending_line');
  });

  it('旧リンクは期限切れとして再発行を案内する', async () => {
    expect((await resend()).status).toBe(200);
    const confirm = await app().request('/api/staff/invitations/confirm/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: OLD_TOKEN }),
    }, bindings());
    expect(confirm.status).toBe(410);
    expect(await confirm.text()).toContain('再発行');
  });

  it('2回目の再送が残る。同時再送は後勝ちで1つだけ生きる', async () => {
    expect((await resend()).status).toBe(200);
    const firstHash = inviteeRow('invitee-1').invite_token_hash;
    expect((await resend()).status).toBe(200);
    const secondHash = inviteeRow('invitee-1').invite_token_hash;
    expect(secondHash).not.toBe(firstHash);
    expect(mail.sendStaffInviteEmail).toHaveBeenCalledTimes(2);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM staff_members').get()).toEqual({ count: 1 });
  });

  it('利用開始済みは409で断る', async () => {
    testDb.raw.prepare(`UPDATE staff_members SET invite_status = 'active', is_active = 1 WHERE id = 'invitee-1'`).run();
    const response = await resend();
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('すでに利用を開始');
    expect(mail.sendStaffInviteEmail).not.toHaveBeenCalled();
  });

  it('staff役割は403で断る', async () => {
    const response = await resend('invitee-1', 'staff');
    expect(response.status).toBe(403);
    expect(mail.sendStaffInviteEmail).not.toHaveBeenCalled();
  });

  it('他テナントの招待は404で見せない', async () => {
    testDb.raw.prepare(`UPDATE staff_members SET tenant_id = 'tenant-other' WHERE id = 'invitee-1'`).run();
    const response = await resend();
    expect(response.status).toBe(404);
    expect(mail.sendStaffInviteEmail).not.toHaveBeenCalled();
  });

  it('存在しない人は404', async () => {
    const response = await resend('nobody');
    expect(response.status).toBe(404);
  });

  it('メール送信に失敗したら500で送り直しを案内する', async () => {
    mail.sendStaffInviteEmail.mockRejectedValueOnce(new Error('relay down'));
    const response = await resend();
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('もう一度送り直してください');
  });
});

describe('招待期限7日 (N-432)', () => {
  beforeEach(() => {
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active)
       VALUES ('account-1', 'channel-1', '本店', 'token', 'secret', 1)`,
    ).run();
  });

  function inviteBody(email: string) {
    return {
      name: '新しい担当者', email, role: 'staff',
      assignedLineAccountId: 'account-1', accountScope: 'all', scopedLineAccountIds: [],
    };
  }

  async function invite(email: string) {
    return app('admin').request('/api/staff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inviteBody(email)),
    }, bindings());
  }

  it('新規招待の期限は7日になる', async () => {
    const response = await invite('newcomer@example.test');
    expect(response.status).toBe(201);
    const body = await response.json() as { success: boolean; data: { inviteExpiresAt: string } };
    expect(body.data.inviteExpiresAt).toBe(new Date(Date.now() + SEVEN_DAYS_MS).toISOString());
  });

  it('招待中のメールを作り直すと409で再送へ案内する(新規行を作らない)', async () => {
    expect((await invite('dupe@example.test')).status).toBe(201);
    const response = await invite('dupe@example.test');
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('招待中');
    expect(testDb.raw.prepare(
      'SELECT COUNT(*) AS count FROM staff_members WHERE email = ?',
    ).get('dupe@example.test')).toEqual({ count: 1 });
  });

  it('利用開始済みメールの作り直しは従来どおり登録済みで断る', async () => {
    testDb.raw.prepare(
      `INSERT INTO staff_members
         (id, name, email, role, api_key, is_active, invite_status)
       VALUES ('active-1', '利用中の人', 'active@example.test', 'staff', 'active-key', 1, 'active')`,
    ).run();
    const response = await invite('active@example.test');
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('登録済みです');
  });
});
