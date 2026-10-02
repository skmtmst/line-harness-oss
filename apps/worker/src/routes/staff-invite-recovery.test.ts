import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

/*
 * M957〜M959（/staff/new の招待作成）。
 * 実D1（better-sqlite3＋bootstrap.sql）で通し、動きで守る。
 * - M957: 作成の後片付けが残す幽霊行を作らない・残っても再招待で掃除する
 * - M958: 招待中メールも一意制約で守る（確認してから入れる間の窓をなくす）
 * - M959: メールアドレスは254文字まで
 */
const mail = vi.hoisted(() => ({ send: vi.fn(), line: vi.fn() }));
vi.mock('../services/staff-invite.js', () => ({
  sendStaffInviteEmail: mail.send,
  sendStaffLineLinkEmail: mail.line,
}));

const { staff } = await import('./staff.js');

let testDb: SqliteD1;

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'env-owner', name: '管理者', role: 'owner', readOnly: false,
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

function inviteBody(email: string) {
  return {
    name: '招待する人',
    email,
    role: 'staff',
    permissionKeys: ['/chats'],
    assignedLineAccountId: 'account-1',
    accountScope: 'accounts',
    scopedLineAccountIds: ['account-1'],
  };
}

function postInvite(email: string) {
  return app().request('/api/staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(inviteBody(email)),
  }, bindings());
}

function count(table: string): number {
  return (testDb.raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function rowsByEmail(email: string) {
  return testDb.raw.prepare('SELECT id, invite_status FROM staff_members WHERE lower(email) = lower(?)').all(email) as Array<{ id: string; invite_status: string }>;
}

const emailOf = (localLength: number) => `${'a'.repeat(localLength)}@example.test`;

beforeEach(() => {
  testDb = createTestD1();
  mail.send.mockReset();
  mail.line.mockReset();
  mail.send.mockResolvedValue(undefined);
  mail.line.mockResolvedValue(undefined);
  testDb.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('account-1', 'channel-1', '店舗A', 'token', 'secret', 1, ?)`,
  ).run(DEFAULT_TENANT_ID);
});

afterEach(() => {
  testDb.raw.close();
});

describe('M957 招待作成の後片付け', () => {
  it('招待メールの送信に失敗したら500を返し、本人・担当範囲のどちらも残さない', async () => {
    mail.send.mockRejectedValueOnce(new Error('relay down'));
    const response = await postInvite('new@example.test');
    expect(response.status).toBe(500);
    expect(count('staff_members')).toBe(0);
    expect(count('staff_account_scopes')).toBe(0);
  });

  it('後片付けの削除自体が失敗して幽霊行が残っても、同じメールの招待し直しで上書き・掃除できる', async () => {
    // 送信されなかった招待が幽霊として残った状態（M957の証拠 W1-partial-rollback-fail）。
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, is_active, invite_status, invite_token_hash, invite_expires_at, tenant_id)
       VALUES ('ghost-1', '幽霊', 'ghost@example.test', 'staff', 'ghost-key', 0, 'pending_email', 'ghost-hash', '2030-01-01T00:00:00.000Z', ?)`,
    ).run(DEFAULT_TENANT_ID);
    const response = await postInvite('ghost@example.test');
    expect(response.status).toBe(201);
    expect(mail.send).toHaveBeenCalledTimes(1);
    const rows = rowsByEmail('ghost@example.test');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe('ghost-1');
    expect(rows[0].invite_status).toBe('pending_email');
  });

  it('利用開始済みの同じメールは作り直さない（登録済みで409）', async () => {
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, is_active, invite_status, tenant_id)
       VALUES ('active-1', '利用中', 'active@example.test', 'staff', 'active-key', 1, 'active', ?)`,
    ).run(DEFAULT_TENANT_ID);
    const response = await postInvite('active@example.test');
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('登録済み');
    expect(mail.send).not.toHaveBeenCalled();
  });
});

describe('M958 招待中メールの一意制約', () => {
  it('招待中（password_hashなし）の同じメールをDBが受け付けない', () => {
    const insert = (id: string) => testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, is_active, invite_status, tenant_id)
       VALUES (?, 'かぶり', 'dupe@example.test', 'staff', ?, 0, 'pending_email', ?)`,
    ).run(id, `${id}-key`, DEFAULT_TENANT_ID);
    insert('dupe-1');
    expect(() => insert('dupe-2')).toThrow(/UNIQUE/i);
  });

  it('大文字・小文字の違いも同じメールとみなす', () => {
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, is_active, invite_status, tenant_id)
       VALUES ('case-1', '一人目', 'Case@example.test', 'staff', 'case-key', 0, 'pending_email', ?)`,
    ).run(DEFAULT_TENANT_ID);
    expect(() => testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, is_active, invite_status, tenant_id)
       VALUES ('case-2', '二人目', 'case@example.test', 'staff', 'case2-key', 0, 'pending_email', ?)`,
    ).run(DEFAULT_TENANT_ID)).toThrow(/UNIQUE/i);
  });
});

describe('M959 メールアドレスの長さ上限', () => {
  it('320文字のメールでは作らず400で断る', async () => {
    const response = await postInvite(emailOf(307));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('254');
    expect(mail.send).not.toHaveBeenCalled();
    expect(count('staff_members')).toBe(0);
  });

  it('255文字のメールでは作らず400で断る', async () => {
    const response = await postInvite(emailOf(242));
    expect(response.status).toBe(400);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('254文字のメールは長さでは断らない（招待が届く）', async () => {
    const response = await postInvite(emailOf(241));
    expect(response.status).toBe(201);
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('本人の変更でも長いメールは400で断る', async () => {
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, is_active, invite_status, tenant_id)
       VALUES ('member-1', '本人', 'me@example.test', 'admin', 'member-key', 1, 'active', ?)`,
    ).run(DEFAULT_TENANT_ID);
    const response = await app().request('/api/staff/member-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailOf(307) }),
    }, bindings());
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('254');
  });
});
