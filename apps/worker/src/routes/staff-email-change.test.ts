import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { sha256Hex } from '../middleware/auth.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

/*
 * N-433(#957)。本人のメール変更は確認メールを経て確定する契約試験。
 * 実D1で通し、即時切り替えをしないこと・使い切り・期限・旧宛先への
 * 知らせを確かめる。
 */
const mail = vi.hoisted(() => ({
  sendStaffInviteEmail: vi.fn(),
  sendStaffLineLinkEmail: vi.fn(),
  sendStaffEmailChangeConfirmEmail: vi.fn(),
  sendStaffEmailChangeNoticeEmail: vi.fn(),
  sendStaffEmailChangeCompletedEmail: vi.fn(),
}));
vi.mock('../services/staff-invite.js', () => mail);

const { staff } = await import('./staff.js');

const NOW = '2026-09-08T01:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;
let testDb: ReturnType<typeof createTestD1>;

function app(selfId = 'self-1', role: 'owner' | 'admin' | 'staff' = 'admin') {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: selfId, name: '本人', role, readOnly: false,
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

function changeRow(id: string): {
  email: string | null; email_change_new: string | null;
  email_change_token_hash: string | null; email_change_expires_at: string | null;
} {
  return testDb.raw.prepare(
    'SELECT email, email_change_new, email_change_token_hash, email_change_expires_at FROM staff_members WHERE id = ?',
  ).get(id) as {
    email: string | null; email_change_new: string | null;
    email_change_token_hash: string | null; email_change_expires_at: string | null;
  };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  testDb = createTestD1();
  Object.values(mail).forEach((fn) => { fn.mockReset(); fn.mockResolvedValue(undefined); });
  testDb.raw.prepare(
    `INSERT INTO staff_members
       (id, name, email, role, api_key, is_active, invite_status)
     VALUES ('self-1', '本人', 'old@example.test', 'admin', 'self-key', 1, 'active')`,
  ).run();
});

afterEach(() => {
  testDb.raw.close();
  vi.useRealTimers();
});

describe('本人のメール変更 (N-433)', () => {
  async function changeSelf(email = 'new@example.test', selfId = 'self-1', role: 'owner' | 'admin' | 'staff' = 'admin') {
    return app(selfId, role).request('/api/staff/self-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }, bindings());
  }

  it('即時には切り替えず、新しい宛先へ確認リンク・旧宛先へ知らせを送る', async () => {
    const response = await changeSelf();
    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; data: { email: string; emailChangePending: boolean; pendingEmail: string } };
    expect(body.data.email).toBe('old@example.test');
    expect(body.data.emailChangePending).toBe(true);
    expect(body.data.pendingEmail).toBe('new@example.test');

    const row = changeRow('self-1');
    expect(row.email).toBe('old@example.test');
    expect(row.email_change_new).toBe('new@example.test');
    expect(row.email_change_expires_at).toBe(new Date(Date.now() + DAY_MS).toISOString());
    expect(row.email_change_token_hash).toBeTruthy();

    expect(mail.sendStaffEmailChangeConfirmEmail).toHaveBeenCalledOnce();
    const confirm = mail.sendStaffEmailChangeConfirmEmail.mock.calls[0][1] as { email: string; confirmUrl: string };
    expect(confirm.email).toBe('new@example.test');
    expect(confirm.confirmUrl).toContain('/staff/email-change#token=');
    expect(mail.sendStaffEmailChangeNoticeEmail).toHaveBeenCalledOnce();
    expect((mail.sendStaffEmailChangeNoticeEmail.mock.calls[0][1] as { email: string }).email).toBe('old@example.test');
  });

  it('確認リンクで確定する。使い切りで2回目は410、旧宛先へ完了の知らせを送る', async () => {
    expect((await changeSelf()).status).toBe(200);
    const confirmUrl = (mail.sendStaffEmailChangeConfirmEmail.mock.calls[0][1] as { confirmUrl: string }).confirmUrl;
    const token = confirmUrl.split('#token=')[1];
    expect(token?.length).toBeGreaterThan(10);

    const confirm = await app().request('/api/staff/email-change/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
    }, bindings());
    expect(confirm.status).toBe(200);

    const row = changeRow('self-1');
    expect(row.email).toBe('new@example.test');
    expect(row.email_change_new).toBeNull();
    expect(row.email_change_token_hash).toBeNull();
    expect(mail.sendStaffEmailChangeCompletedEmail).toHaveBeenCalledOnce();
    expect((mail.sendStaffEmailChangeCompletedEmail.mock.calls[0][1] as { email: string }).email).toBe('old@example.test');

    /* 使い切り。同じリンクをもう一度開いても410。 */
    const again = await app().request('/api/staff/email-change/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
    }, bindings());
    expect(again.status).toBe(410);
  });

  it('期限切れのリンクは410', async () => {
    expect((await changeSelf()).status).toBe(200);
    const confirmUrl = (mail.sendStaffEmailChangeConfirmEmail.mock.calls[0][1] as { confirmUrl: string }).confirmUrl;
    const token = confirmUrl.split('#token=')[1];
    vi.setSystemTime(new Date(Date.now() + DAY_MS + 1000));
    const confirm = await app().request('/api/staff/email-change/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
    }, bindings());
    expect(confirm.status).toBe(410);
    expect(changeRow('self-1').email).toBe('old@example.test');
  });

  it('確定の直前に取られたメールは409で断り、申し込みを消す', async () => {
    expect((await changeSelf()).status).toBe(200);
    testDb.raw.prepare(
      `INSERT INTO staff_members
         (id, name, email, role, api_key, is_active, invite_status)
       VALUES ('other-1', '別の人', 'new@example.test', 'staff', 'other-key', 1, 'active')`,
    ).run();
    const confirmUrl = (mail.sendStaffEmailChangeConfirmEmail.mock.calls[0][1] as { confirmUrl: string }).confirmUrl;
    const token = confirmUrl.split('#token=')[1];
    const confirm = await app().request('/api/staff/email-change/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
    }, bindings());
    expect(confirm.status).toBe(409);
    expect(changeRow('self-1').email).toBe('old@example.test');
    expect(changeRow('self-1').email_change_token_hash).toBeNull();
  });

  it('管理者が他人のメールを変えるときは従来どおり即時に切り替わる', async () => {
    testDb.raw.prepare(
      `INSERT INTO staff_members
         (id, name, email, role, api_key, is_active, invite_status)
       VALUES ('member-1', '対象の人', 'member@example.test', 'staff', 'member-key', 1, 'active')`,
    ).run();
    const response = await app('admin-actor', 'admin').request('/api/staff/member-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'member-new@example.test' }),
    }, bindings());
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { email: string; emailChangePending?: boolean } };
    expect(body.data.email).toBe('member-new@example.test');
    expect(body.data.emailChangePending).toBeUndefined();
    expect(mail.sendStaffEmailChangeConfirmEmail).not.toHaveBeenCalled();
  });

  it('同じメールの保存は確認を起こさない', async () => {
    const response = await changeSelf('OLD@example.test');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { emailChangePending?: boolean } };
    expect(body.data.emailChangePending).toBeUndefined();
    expect(mail.sendStaffEmailChangeConfirmEmail).not.toHaveBeenCalled();
    expect(changeRow('self-1').email_change_token_hash).toBeNull();
  });

  it('自分のメールを空にはできない', async () => {
    const response = await app().request('/api/staff/self-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: null }),
    }, bindings());
    expect(response.status).toBe(400);
    expect(changeRow('self-1').email).toBe('old@example.test');
  });

  it('staff役割の本人変更でも確認メールを送る', async () => {
    const response = await changeSelf('staff-new@example.test', 'self-1', 'staff');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { emailChangePending?: boolean } };
    expect(body.data.emailChangePending).toBe(true);
    expect(mail.sendStaffEmailChangeConfirmEmail).toHaveBeenCalledOnce();
  });
});
