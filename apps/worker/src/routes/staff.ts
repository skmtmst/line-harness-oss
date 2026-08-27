import { Hono } from 'hono';
import {
  getStaffMembers, getStaffById, getStaffByInviteTokenHash,
  createStaffMember, updateStaffMember, deleteStaffMember, countLoginAudit,
  getStaffAccountScopeIds, replaceStaffAccountScopes,
} from '@line-crm/db';
import type { StaffMember } from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import { sha256Hex } from '../middleware/auth.js';
import { sendStaffInviteEmail, sendStaffLineLinkEmail } from '../services/staff-invite.js';
import { buildTotpUri, decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotp } from '../lib/totp.js';
import type { Env } from '../index.js';
import { getLineAccounts } from '@line-crm/db';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';

const staff = new Hono<Env>();
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function displayRole(row: StaffMember): 'admin' | 'staff' | 'viewer' {
  if (row.access_level === 'read_only') return 'viewer';
  return row.role === 'staff' ? 'staff' : 'admin';
}

async function serializeStaff(db: D1Database, row: StaffMember) {
  const accountScope = row.account_scope ?? 'all';
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: displayRole(row),
    lineLinked: Boolean(row.line_user_id),
    twoFactorEnabled: Boolean(row.totp_enabled_at && row.totp_secret_enc),
    isActive: Boolean(row.is_active),
    permissionKeys: safeJson<string[]>(row.permission_keys, []),
    notificationPreferences: safeJson<Record<string, { email: boolean; line: boolean }>>(row.notification_preferences, {}),
    inviteStatus: row.invite_status || 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignedLineAccountId: row.assigned_line_account_id ?? null,
    canAccessDescendantAccounts: Boolean(row.can_access_descendant_accounts),
    accountScope,
    scopedLineAccountIds: accountScope === 'accounts' ? await getStaffAccountScopeIds(db, row.id) : [],
  };
}

type AccountScopeInput = {
  accountScope?: 'all' | 'accounts';
  scopedLineAccountIds?: string[];
};

function normalizeAccountScopeInput(body: AccountScopeInput):
  | { accountScope: undefined; scopedLineAccountIds: undefined }
  | { accountScope: 'all' | 'accounts'; scopedLineAccountIds: string[] }
  | { error: string } {
  if (body.accountScope === undefined) {
    return { accountScope: undefined, scopedLineAccountIds: undefined };
  }
  if (body.accountScope !== 'all' && body.accountScope !== 'accounts') {
    return { error: '店舗の権限範囲が正しくありません' };
  }
  if (body.accountScope === 'all') return { accountScope: 'all', scopedLineAccountIds: [] };
  if (!Array.isArray(body.scopedLineAccountIds)) return { error: '指定店舗を選択してください' };
  const ids = [...new Set(body.scopedLineAccountIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0 || ids.length !== body.scopedLineAccountIds.length) {
    return { error: '指定店舗を1つ以上選択してください' };
  }
  return { accountScope: 'accounts', scopedLineAccountIds: ids };
}

async function hasAllAccountScope(db: D1Database, current: Env['Variables']['staff']): Promise<boolean> {
  if (current.id === 'env-owner') return true;
  return (await getStaffById(db, current.id))?.account_scope !== 'accounts';
}

async function mayAssignAccountScopes(
  db: D1Database,
  current: Env['Variables']['staff'],
  requestedScope: 'all' | 'accounts',
  requestedIds: string[],
): Promise<boolean> {
  if (current.id === 'env-owner') return true;
  const currentMember = current.id === 'env-owner' ? null : await getStaffById(db, current.id);
  if (requestedScope === 'all') return currentMember?.account_scope !== 'accounts';
  const allowedIds = currentMember?.account_scope === 'accounts'
    ? await getStaffAccountScopeIds(db, current.id)
    : (await getVisibleLineAccountScope(db, current)).allowedAccountIds;
  return requestedIds.every((id) => allowedIds.includes(id));
}

/**
 * 設定を変えられる管理者。
 *
 * 役割が管理者でも、閲覧のみ（read_only）の人は更新系を一切通せないので、
 * 「最後の一人」を数えるときは頭数に入れない。無効化された人も同じ。
 */
function canAdminister(row: StaffMember): boolean {
  return Boolean(row.is_active) && row.role !== 'staff' && row.access_level !== 'read_only';
}

function currentTenantId(c: { get: (key: 'staff') => Env['Variables']['staff'] }): string {
  return c.get('staff').tenantId ?? DEFAULT_TENANT_ID;
}

function isInCurrentTenant(
  c: { get: (key: 'staff') => Env['Variables']['staff'] },
  member: StaffMember,
): boolean {
  return (member.tenant_id ?? DEFAULT_TENANT_ID) === currentTenantId(c);
}

/**
 * 管理画面から誰も入れなくなる操作を止める。
 *
 * 一度これをやると、画面からは元に戻せない（無効な人は一覧に残るが、
 * それを有効化できる人がもういない）。DBを直接触るしか復旧手段が
 * なくなるので、サーバー側で断る。
 *
 * 戻り値はエラー文言。問題なければ null。
 */
async function guardLastAdmin(
  db: D1Database,
  target: StaffMember,
  tenantId: string,
  change: { isActive?: boolean; role?: 'admin' | 'staff' | 'viewer'; self: boolean },
): Promise<string | null> {
  if (!canAdminister(target)) return null;

  const stillAdmin =
    (change.isActive === undefined ? Boolean(target.is_active) : change.isActive) &&
    (change.role === undefined ? target.role !== 'staff' : change.role === 'admin') &&
    (change.role === undefined ? target.access_level !== 'read_only' : change.role !== 'viewer');
  if (stillAdmin) return null;

  if (change.self) return '自分自身の管理者権限は外せません。他の管理者に依頼してください。';

  const others = (await getStaffMembers(db, tenantId)).filter((row) => row.id !== target.id && canAdminister(row));
  if (others.length > 0) return null;
  return '管理者が一人もいなくなります。先に別の管理者を有効にしてください。';
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
      return c.json({ success: true, data: { id: current.id, name: '管理者', role: 'admin', email: null, permissionKeys: [], assignedLineAccountId: null, canAccessDescendantAccounts: true, accountScope: 'all', scopedLineAccountIds: [] } });
    }
    const member = await getStaffById(c.env.DB, current.id);
    if (!member) return c.json({ success: false, error: 'Staff member not found' }, 404);
    return c.json({ success: true, data: await serializeStaff(c.env.DB, member) });
  } catch (error) {
    console.error('GET /api/staff/me error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

staff.get('/api/staff', async (c) => {
  try {
    const members = await getStaffMembers(c.env.DB, currentTenantId(c));
    return c.json({ success: true, data: await Promise.all(members.map((member) => serializeStaff(c.env.DB, member))) });
  } catch (error) {
    console.error('GET /api/staff error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

staff.get('/api/staff/:id/login-summary', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const member = await getStaffById(c.env.DB, id);
    if (!member || !isInCurrentTenant(c, member)) return c.json({ success: false, error: 'Staff member not found' }, 404);
    const loginCount = await countLoginAudit(c.env.DB, { adminUserId: id, action: 'login' });
    return c.json({ success: true, data: { loginCount } });
  } catch (error) {
    console.error('GET /api/staff/:id/login-summary error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

staff.get('/api/staff/:id', async (c) => {
  const member = await getStaffById(c.env.DB, c.req.param('id'));
  return member && isInCurrentTenant(c, member)
    ? c.json({ success: true, data: await serializeStaff(c.env.DB, member) })
    : c.json({ success: false, error: 'Staff member not found' }, 404);
});

staff.post('/api/staff', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      name?: string; email?: string; role?: 'admin' | 'staff' | 'viewer'; permissionKeys?: string[];
      notificationPreferences?: Record<string, { email: boolean; line: boolean }>;
      assignedLineAccountId?: string | null;
      canAccessDescendantAccounts?: boolean;
      accountScope?: 'all' | 'accounts'; scopedLineAccountIds?: string[]; managementContext?: 'hq';
    }>();
    const accountScope = normalizeAccountScopeInput(body);
    if ('error' in accountScope) return c.json({ success: false, error: accountScope.error }, 400);
    if (accountScope.accountScope === undefined) return c.json({ success: false, error: '担当範囲を選んでください' }, 400);
    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    if (!name) return c.json({ success: false, error: '名前を入力してください' }, 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ success: false, error: '正しいメールアドレスを入力してください' }, 400);
    if (!body.role || !['admin', 'staff', 'viewer'].includes(body.role)) return c.json({ success: false, error: '役割を選択してください' }, 400);
    if (!body.assignedLineAccountId) {
      return c.json({ success: false, error: '担当するLINEアカウントを選択してください' }, 400);
    }
    const visibleAccounts = (await getVisibleLineAccountScope(c.env.DB, c.get('staff'))).accounts;
    if (!visibleAccounts.some((account) => account.id === body.assignedLineAccountId)) {
      return c.json({ success: false, error: '権限のないLINEアカウントは割り当てできません' }, 403);
    }
    const current = c.get('staff');
    if (body.managementContext === 'hq' && !await hasAllAccountScope(c.env.DB, current)) {
      return c.json({ success: false, error: '全店舗の担当者だけが統括側の権限者を追加できます' }, 403);
    }
    const canGrantDescendants =
      current.role === 'owner' ||
      !current.assignedLineAccountId ||
      current.canAccessDescendantAccounts;
    if (body.canAccessDescendantAccounts && !canGrantDescendants) {
      return c.json({ success: false, error: '自分が持っていない他アカウント権限は付与できません' }, 403);
    }
    if (accountScope.accountScope !== undefined && !await mayAssignAccountScopes(c.env.DB, current, accountScope.accountScope, accountScope.scopedLineAccountIds)) {
      return c.json({ success: false, error: '権限のないLINEアカウントは指定できません' }, 403);
    }
    if ((await getStaffMembers(c.env.DB, currentTenantId(c))).some((item) => item.email?.toLowerCase() === email)) {
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
      assigned_line_account_id: body.assignedLineAccountId,
      can_access_descendant_accounts: body.role === 'admin' && Boolean(body.canAccessDescendantAccounts),
      account_scope: accountScope.accountScope,
      tenant_id: current.tenantId ?? DEFAULT_TENANT_ID,
    });
    try {
      await replaceStaffAccountScopes(c.env.DB, member.id, accountScope.scopedLineAccountIds);
      await sendStaffInviteEmail(c.env, {
        name, email,
        verifyUrl: `${new URL(c.req.url).origin}/api/staff/invitations/${encodeURIComponent(token)}/verify`,
      });
    } catch (error) {
      await deleteStaffMember(c.env.DB, member.id);
      throw error;
    }
    return c.json({ success: true, data: await serializeStaff(c.env.DB, member) }, 201);
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

staff.patch('/api/staff/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string; email?: string | null; role?: 'admin' | 'staff' | 'viewer'; isActive?: boolean;
    lineLinked?: boolean;
    permissionKeys?: string[]; notificationPreferences?: Record<string, { email: boolean; line: boolean }>;
    assignedLineAccountId?: string | null; canAccessDescendantAccounts?: boolean;
    accountScope?: 'all' | 'accounts'; scopedLineAccountIds?: string[]; managementContext?: 'hq';
  }>();
  const accountScope = normalizeAccountScopeInput(body);
  if ('error' in accountScope) return c.json({ success: false, error: accountScope.error }, 400);

  const target = await getStaffById(c.env.DB, id);
  if (!target || !isInCurrentTenant(c, target)) return c.json({ success: false, error: 'Staff member not found' }, 404);
  const current = c.get('staff');
  if (body.managementContext === 'hq' && !await hasAllAccountScope(c.env.DB, current)) {
    return c.json({ success: false, error: '全店舗の担当者だけが統括側の権限者を変更できます' }, 403);
  }
  const administrator = current.role === 'owner' || current.role === 'admin';
  if (!administrator && current.id !== id) {
    return c.json({ success: false, error: 'スタッフは自分の設定だけ変更できます' }, 403);
  }
  if (!administrator && (
    body.name !== undefined || body.role !== undefined || body.isActive !== undefined || body.permissionKeys !== undefined ||
    body.assignedLineAccountId !== undefined || body.canAccessDescendantAccounts !== undefined || body.accountScope !== undefined
  )) {
    return c.json({ success: false, error: '権限と利用状態は管理者だけが変更できます' }, 403);
  }
  if (body.email !== undefined && body.email !== null) {
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ success: false, error: '正しいメールアドレスを入力してください' }, 400);
    }
    const duplicate = (await getStaffMembers(c.env.DB, currentTenantId(c))).some((member) => member.id !== id && member.email?.toLowerCase() === email);
    if (duplicate) return c.json({ success: false, error: 'このメールアドレスは登録済みです' }, 409);
    body.email = email;
  }

  const guard = await guardLastAdmin(c.env.DB, target, currentTenantId(c), {
    isActive: body.isActive,
    role: body.role,
    self: id === c.get('staff').id,
  });
  if (guard) return c.json({ success: false, error: guard }, 400);

  if (administrator && body.assignedLineAccountId !== undefined) {
    if (!body.assignedLineAccountId) {
      return c.json({ success: false, error: '担当するLINEアカウントを選択してください' }, 400);
    }
    const visibleAccounts = (await getVisibleLineAccountScope(c.env.DB, current)).accounts;
    if (!visibleAccounts.some((account) => account.id === body.assignedLineAccountId)) {
      return c.json({ success: false, error: '権限のないLINEアカウントは割り当てできません' }, 403);
    }
  }
  if (
    body.canAccessDescendantAccounts &&
    current.role !== 'owner' &&
    current.assignedLineAccountId &&
    !current.canAccessDescendantAccounts
  ) {
    return c.json({ success: false, error: '自分が持っていない他アカウント権限は付与できません' }, 403);
  }
  if (administrator && accountScope.accountScope !== undefined && !await mayAssignAccountScopes(c.env.DB, current, accountScope.accountScope, accountScope.scopedLineAccountIds)) {
    return c.json({ success: false, error: '権限のないLINEアカウントは指定できません' }, 403);
  }

  const updated = await updateStaffMember(c.env.DB, id, {
    name: body.name, email: body.email,
    role: body.role === 'admin' ? 'admin' : body.role ? 'staff' : undefined,
    access_level: body.role === undefined ? undefined : body.role === 'viewer' ? 'read_only' : 'full',
    is_active: body.isActive === undefined ? undefined : body.isActive ? 1 : 0,
    // 連携を外すだけ。付け直しはLINEログイン側でしか起こらないので、
    // ここで受けるのは false（解除）のときだけにする。
    line_user_id: body.lineLinked === false ? null : undefined,
    line_linked_at: body.lineLinked === false ? null : undefined,
    permission_keys: body.permissionKeys,
    notification_preferences: body.notificationPreferences,
    assigned_line_account_id: body.assignedLineAccountId,
    can_access_descendant_accounts:
      body.role === 'admin' || (body.role === undefined && target.role !== 'staff')
        ? body.canAccessDescendantAccounts
        : false,
    account_scope: accountScope.accountScope,
  });
  if (updated && accountScope.accountScope !== undefined) {
    await replaceStaffAccountScopes(c.env.DB, id, accountScope.scopedLineAccountIds);
  }
  return updated ? c.json({ success: true, data: await serializeStaff(c.env.DB, updated) }) : c.json({ success: false, error: 'Staff member not found' }, 404);
});

function canEditMember(c: { get: (key: 'staff') => Env['Variables']['staff'] }, id: string): boolean {
  const current = c.get('staff');
  return current.role === 'owner' || current.role === 'admin' || current.id === id;
}

function totpMasterKey(c: { env: Env['Bindings'] }): string | null {
  return c.env.TOTP_ENCRYPTION_KEY?.trim() || null;
}

staff.post('/api/staff/:id/two-factor/setup', async (c) => {
  const id = c.req.param('id');
  const member = await getStaffById(c.env.DB, id);
  if (!member || !isInCurrentTenant(c, member)) return c.json({ success: false, error: 'Staff member not found' }, 404);
  if (!canEditMember(c, id)) return c.json({ success: false, error: '自分の二段階認証だけ設定できます' }, 403);
  const key = totpMasterKey(c);
  if (!key) return c.json({ success: false, error: '二段階認証の暗号鍵が設定されていません' }, 503);

  const secret = generateTotpSecret();
  await updateStaffMember(c.env.DB, id, {
    totp_pending_secret_enc: await encryptTotpSecret(secret, key),
  });
  return c.json({
    success: true,
    data: {
      provisioningUri: buildTotpUri(secret, member.email || member.name),
      manualKey: secret.match(/.{1,4}/g)?.join(' ') ?? secret,
    },
  });
});

staff.post('/api/staff/:id/two-factor/confirm', async (c) => {
  const id = c.req.param('id');
  const member = await getStaffById(c.env.DB, id);
  if (!member || !isInCurrentTenant(c, member)) return c.json({ success: false, error: 'Staff member not found' }, 404);
  if (!canEditMember(c, id)) return c.json({ success: false, error: '自分の二段階認証だけ設定できます' }, 403);
  const key = totpMasterKey(c);
  if (!key) return c.json({ success: false, error: '二段階認証の暗号鍵が設定されていません' }, 503);
  if (!member?.totp_pending_secret_enc) return c.json({ success: false, error: '先にQRコードを表示してください' }, 400);
  const body = await c.req.json<{ code?: string }>().catch(() => ({} as { code?: string }));
  const encrypted = member.totp_pending_secret_enc;
  const result = await verifyTotp(await decryptTotpSecret(encrypted, key), body.code ?? '');
  if (!result.valid) return c.json({ success: false, error: '認証コードが正しくありません' }, 400);
  const updated = await updateStaffMember(c.env.DB, id, {
    totp_secret_enc: encrypted,
    totp_pending_secret_enc: null,
    totp_enabled_at: new Date().toISOString(),
    totp_last_used_step: null,
  });
  return c.json({ success: true, data: await serializeStaff(c.env.DB, updated!) });
});

staff.delete('/api/staff/:id/two-factor', async (c) => {
  const id = c.req.param('id');
  const member = await getStaffById(c.env.DB, id);
  if (!member || !isInCurrentTenant(c, member)) return c.json({ success: false, error: 'Staff member not found' }, 404);
  if (!canEditMember(c, id)) return c.json({ success: false, error: '自分の二段階認証だけ解除できます' }, 403);
  const updated = await updateStaffMember(c.env.DB, id, {
    totp_secret_enc: null,
    totp_pending_secret_enc: null,
    totp_enabled_at: null,
    totp_last_used_step: null,
  });
  return updated ? c.json({ success: true, data: await serializeStaff(c.env.DB, updated) }) : c.json({ success: false, error: 'Staff member not found' }, 404);
});

staff.delete('/api/staff/:id', requireRole('owner', 'admin'), async (c) => {
  const id = c.req.param('id');
  if (id === c.get('staff').id) return c.json({ success: false, error: '自分自身は削除できません' }, 400);
  const target = await getStaffById(c.env.DB, id);
  if (!target || !isInCurrentTenant(c, target)) return c.json({ success: false, error: 'Staff member not found' }, 404);
  const guard = await guardLastAdmin(c.env.DB, target, currentTenantId(c), { isActive: false, self: false });
  if (guard) return c.json({ success: false, error: guard }, 400);
  await deleteStaffMember(c.env.DB, id);
  return c.json({ success: true, data: null });
});

export { staff };
