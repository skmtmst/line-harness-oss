import { Hono } from 'hono';
import {
  getStaffMembers, getStaffById, getStaffByInviteTokenHash,
  createStaffMember, updateStaffMember, deleteStaffMember,
} from '@line-crm/db';
import type { StaffMember } from '@line-crm/db';
import { denyReadOnly, requireRole } from '../middleware/role-guard.js';
import { sha256Hex } from '../middleware/auth.js';
import { sendStaffInviteEmail, sendStaffLineLinkEmail } from '../services/staff-invite.js';
import type { Env } from '../index.js';

const staff = new Hono<Env>();
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function displayRole(row: StaffMember): 'admin' | 'staff' | 'viewer' {
  if (row.access_level === 'read_only') return 'viewer';
  return row.role === 'staff' ? 'staff' : 'admin';
}

function serializeStaff(row: StaffMember) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: displayRole(row),
    lineLinked: Boolean(row.line_user_id),
    isActive: Boolean(row.is_active),
    permissionKeys: safeJson<string[]>(row.permission_keys, []),
    notificationPreferences: safeJson<Record<string, { email: boolean; line: boolean }>>(row.notification_preferences, {}),
    inviteStatus: row.invite_status || 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

staff.get('/api/staff/me', async (c) => {
  try {
    const current = c.get('staff');
    if (current.id === 'env-owner') {
      return c.json({ success: true, data: { id: current.id, name: '管理者', role: 'admin', email: null, permissionKeys: [] } });
    }
    const member = await getStaffById(c.env.DB, current.id);
    if (!member) return c.json({ success: false, error: 'Staff member not found' }, 404);
    return c.json({ success: true, data: serializeStaff(member) });
  } catch (error) {
    console.error('GET /api/staff/me error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

staff.get('/api/staff', requireRole('owner', 'admin'), denyReadOnly(), async (c) => {
  try {
    return c.json({ success: true, data: (await getStaffMembers(c.env.DB)).map(serializeStaff) });
  } catch (error) {
    console.error('GET /api/staff error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

staff.get('/api/staff/:id', requireRole('owner', 'admin'), denyReadOnly(), async (c) => {
  const member = await getStaffById(c.env.DB, c.req.param('id'));
  return member ? c.json({ success: true, data: serializeStaff(member) }) : c.json({ success: false, error: 'Staff member not found' }, 404);
});

staff.post('/api/staff', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      name?: string; email?: string; role?: 'admin' | 'staff' | 'viewer'; permissionKeys?: string[];
      notificationPreferences?: Record<string, { email: boolean; line: boolean }>;
    }>();
    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    if (!name) return c.json({ success: false, error: '名前を入力してください' }, 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ success: false, error: '正しいメールアドレスを入力してください' }, 400);
    if (!body.role || !['admin', 'staff', 'viewer'].includes(body.role)) return c.json({ success: false, error: '役割を選択してください' }, 400);
    if ((await getStaffMembers(c.env.DB)).some((item) => item.email?.toLowerCase() === email)) {
      return c.json({ success: false, error: 'このメールアドレスは登録済みです' }, 409);
    }

    const token = randomToken();
    const member = await createStaffMember(c.env.DB, {
      name, email,
      role: body.role === 'admin' ? 'admin' : 'staff',
      access_level: body.role === 'viewer' ? 'read_only' : 'full',
      is_active: 0,
      permission_keys: body.role === 'staff' ? (body.permissionKeys ?? []) : [],
      notification_preferences: body.notificationPreferences ?? {},
      invite_status: 'pending_email',
      invite_token_hash: await sha256Hex(token),
      invite_expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    });
    try {
      await sendStaffInviteEmail(c.env, {
        name, email,
        verifyUrl: `${new URL(c.req.url).origin}/api/staff/invitations/${encodeURIComponent(token)}/verify`,
      });
    } catch (error) {
      await deleteStaffMember(c.env.DB, member.id);
      throw error;
    }
    return c.json({ success: true, data: serializeStaff(member) }, 201);
  } catch (error) {
    console.error('POST /api/staff error:', error);
    return c.json({ success: false, error: '招待メールを送信できませんでした' }, 500);
  }
});

staff.get('/api/staff/invitations/:token/verify', async (c) => {
  const token = c.req.param('token');
  const member = await getStaffByInviteTokenHash(c.env.DB, await sha256Hex(token));
  if (!member || !member.email || !member.invite_expires_at || Date.parse(member.invite_expires_at) < Date.now()) {
    return c.html('<!doctype html><meta charset="utf-8"><title>招待の有効期限切れ</title><p>この招待は無効または期限切れです。管理者へ再発行を依頼してください。</p>', 410);
  }
  if (member.invite_status === 'pending_email') {
    await updateStaffMember(c.env.DB, member.id, { invite_status: 'pending_line', email_verified_at: new Date().toISOString() });
    await sendStaffLineLinkEmail(c.env, {
      name: member.name, email: member.email,
      lineUrl: `${new URL(c.req.url).origin}/api/auth/line?invite=${encodeURIComponent(token)}`,
    });
  }
  return c.html('<!doctype html><meta charset="utf-8"><title>メール確認完了</title><main style="font-family:sans-serif;max-width:560px;margin:80px auto;padding:24px"><h1>メールアドレスを確認しました</h1><p>続けて届くメールからLINE連携を完了してください。</p></main>');
});

staff.patch('/api/staff/:id', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{
    name?: string; email?: string | null; role?: 'admin' | 'staff' | 'viewer'; isActive?: boolean;
    permissionKeys?: string[]; notificationPreferences?: Record<string, { email: boolean; line: boolean }>;
  }>();
  const updated = await updateStaffMember(c.env.DB, c.req.param('id'), {
    name: body.name, email: body.email,
    role: body.role === 'admin' ? 'admin' : body.role ? 'staff' : undefined,
    access_level: body.role === undefined ? undefined : body.role === 'viewer' ? 'read_only' : 'full',
    is_active: body.isActive === undefined ? undefined : body.isActive ? 1 : 0,
    permission_keys: body.permissionKeys,
    notification_preferences: body.notificationPreferences,
  });
  return updated ? c.json({ success: true, data: serializeStaff(updated) }) : c.json({ success: false, error: 'Staff member not found' }, 404);
});

staff.delete('/api/staff/:id', requireRole('owner', 'admin'), async (c) => {
  const id = c.req.param('id');
  if (id === c.get('staff').id) return c.json({ success: false, error: '自分自身は削除できません' }, 400);
  if (!await getStaffById(c.env.DB, id)) return c.json({ success: false, error: 'Staff member not found' }, 404);
  await deleteStaffMember(c.env.DB, id);
  return c.json({ success: true, data: null });
});

export { staff };
