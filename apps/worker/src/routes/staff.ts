import { Hono } from 'hono';
import {
  getStaffMembers, getStaffById, getStaffByInviteTokenHash,
  createStaffMember, updateStaffMember, deleteStaffMember, countLoginAudit,
  getStaffAccountScopeIds, getStaffAccountScopeMap, replaceStaffAccountScopes, revokeStaffAuthentication,
  reserveTwoFactorSetupAttempt, clearTwoFactorSetupAttempts,
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
// 招待の有効期限は7日。要件 v6-30 §9-2・§17(既存の48時間招待はその期限のまま守り、新規・再送から7日)。
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_FACTOR_ATTEMPT_LIMIT_ERROR = '入力回数を超えました。しばらく待ってからやり直してください';

function invitationConfirmationUrl(c: { env: Env['Bindings']; req: { url: string } }, token: string): string {
  const base = c.env.ADMIN_PUBLIC_URL?.trim() || new URL(c.req.url).origin;
  const url = new URL('/staff/invite', base);
  // fragment はHTTPリクエストやアクセスログへ送られない。確認画面が読み取ったら即座に消す。
  url.hash = new URLSearchParams({ invite: token }).toString();
  return url.toString();
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function displayRole(row: StaffMember): 'admin' | 'staff' | 'viewer' {
  if (row.access_level === 'read_only') return 'viewer';
  return row.role === 'staff' ? 'staff' : 'admin';
}

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  return at > 0 ? `${email.slice(0, 1)}***${email.slice(at)}` : '***';
}

function canViewStaffEmail(c: { get: (key: 'staff') => Env['Variables']['staff'] }, targetId: string): boolean {
  const current = c.get('staff');
  return current.id === targetId || current.role === 'owner' || current.role === 'admin'
    || current.permissionKeys?.includes('access.user.email.view') === true;
}

async function serializeStaff(
  db: D1Database,
  row: StaffMember,
  exposeEmail = true,
  preloadedScopes?: Map<string, string[]>,
) {
  const accountScope = row.account_scope ?? 'all';
  return {
    id: row.id,
    // The browser uses this authenticated scope to namespace recoverable
    // idempotency receipts. It is an identifier, never a credential.
    tenantId: row.tenant_id ?? DEFAULT_TENANT_ID,
    name: row.name,
    email: exposeEmail ? row.email : maskEmail(row.email),
    role: displayRole(row),
    lineLinked: Boolean(row.line_user_id),
    twoFactorEnabled: Boolean(row.totp_enabled_at && row.totp_secret_enc),
    isActive: Boolean(row.is_active),
    permissionKeys: safeJson<string[]>(row.permission_keys, []),
    notificationPreferences: safeJson<Record<string, { email: boolean; line: boolean }>>(row.notification_preferences, {}),
    inviteStatus: row.invite_status || 'active',
    inviteExpiresAt: row.invite_expires_at ?? null,
    policyVersion: Number(row.policy_version ?? 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignedLineAccountId: row.assigned_line_account_id ?? null,
    canAccessDescendantAccounts: Boolean(row.can_access_descendant_accounts),
    accountScope,
    scopedLineAccountIds: accountScope === 'accounts'
      ? (preloadedScopes?.get(row.id) ?? await getStaffAccountScopeIds(db, row.id))
      : [],
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

const NOTIFICATION_KEYS = new Set(['operations', 'emergency', 'security', 'updates']);
const PERMISSION_KEY_PATTERN = /^[A-Za-z0-9_./-]{1,200}$/;

/*
 * 権限キーと通知設定の検証(#515 中3)。
 * 存在しない権限パスで「権限あり」に見える・将来の判定の抜け道になるのを防ぐ。
 * キー表は画面側( staff/page.tsx・staff/new/page.tsx )と他機能の点キー
 * (ec.event.view 等)が混在するため、ここでは形式と通知の種類を締める。
 * パス表の完全なホワイトリスト化はキー台帳の整備後に行う。
 */
function invalidPermissionKeys(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return '表示する機能の形式が正しくありません';
  if (value.length > 200) return '表示する機能が多すぎます';
  const bad = value.some((key) => typeof key !== 'string' || !PERMISSION_KEY_PATTERN.test(key));
  return bad ? '表示する機能に使えない文字があります' : null;
}

function invalidNotificationPreferences(value: unknown): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '通知設定の形式が正しくありません';
  for (const [key, channels] of Object.entries(value as Record<string, unknown>)) {
    if (!NOTIFICATION_KEYS.has(key)) return '通知設定にない種類があります';
    if (!channels || typeof channels !== 'object' || Array.isArray(channels)) return '通知設定の形式が正しくありません';
    const { email, line } = channels as Record<string, unknown>;
    if (typeof email !== 'boolean' || typeof line !== 'boolean') return '通知設定はオン・オフで指定してください';
  }
  return null;
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
      return c.json({ success: true, data: { id: current.id, tenantId: current.tenantId ?? DEFAULT_TENANT_ID, name: '管理者', role: 'admin', email: null, permissionKeys: [], assignedLineAccountId: null, canAccessDescendantAccounts: true, accountScope: 'all', scopedLineAccountIds: [] } });
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
    // 担当範囲を1人ずつ読むと人数分の往復になるので一括取得する(#515 中1)。
    const scopes = await getStaffAccountScopeMap(
      c.env.DB,
      members.filter((member) => (member.account_scope ?? 'all') === 'accounts').map((member) => member.id),
    );
    return c.json({
      success: true,
      data: await Promise.all(members.map((member) => (
        serializeStaff(c.env.DB, member, canViewStaffEmail(c, member.id), scopes)
      ))),
    });
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

staff.get('/api/staff/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  const id = c.req.param('id');
  const current = c.get('staff');
  if (current.id !== id && current.role !== 'owner' && current.role !== 'admin') {
    return c.json({ success: false, error: 'この情報を表示する権限がありません' }, 403);
  }
  const member = await getStaffById(c.env.DB, id);
  return member && isInCurrentTenant(c, member)
    ? c.json({ success: true, data: await serializeStaff(c.env.DB, member, canViewStaffEmail(c, member.id)) })
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
    const keyError = invalidPermissionKeys(body.permissionKeys) ?? invalidNotificationPreferences(body.notificationPreferences);
    if (keyError) return c.json({ success: false, error: keyError }, 400);
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
    // 同じメールの行があるときは作り直さない。要件 v6-30 §9-2(既存メールは新規行を作らず、管理者へ安全な案内)。
    // 招待中・期限切れなら再送へ案内し、利用開始済みなら従来どおり登録済みで断る(N-425)。
    const duplicateInvite = (await getStaffMembers(c.env.DB, currentTenantId(c)))
      .find((item) => item.email?.toLowerCase() === email);
    if (duplicateInvite) {
      if (duplicateInvite.invite_status === 'pending_email' || duplicateInvite.invite_status === 'pending_line' || duplicateInvite.invite_status === 'expired') {
        return c.json({ success: false, error: 'このメールアドレスは招待中です。新しく作り直さず、ログインユーザー画面の「招待中」タブからもう一度送り直してください。' }, 409);
      }
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
        verifyUrl: invitationConfirmationUrl(c, token),
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
  return c.redirect(invitationConfirmationUrl(c, token), 302);
});

staff.post('/api/staff/invitations/confirm/verify', async (c) => {
  const body = await c.req.json<{ token?: string }>().catch(() => ({} as { token?: string }));
  const token = body.token?.trim() ?? '';
  if (!token || token.length > 512) {
    return c.json({ success: false, error: '招待情報が正しくありません' }, 400);
  }
  const member = await getStaffByInviteTokenHash(c.env.DB, await sha256Hex(token));
  if (!member || !member.email || !member.invite_expires_at || Date.parse(member.invite_expires_at) < Date.now()) {
    return c.json({ success: false, error: 'この招待は無効または期限切れです。管理者へ再発行を依頼してください。' }, 410);
  }
  if (member.invite_status === 'pending_email') {
    await updateStaffMember(c.env.DB, member.id, { invite_status: 'pending_line', email_verified_at: new Date().toISOString() });
    await sendStaffLineLinkEmail(c.env, {
      name: member.name, email: member.email,
      lineUrl: `${new URL(c.req.url).origin}/api/auth/line?invite=${encodeURIComponent(token)}`,
    });
  }
  return c.json({ success: true, data: { status: 'pending_line' } });
});

/*
 * 招待の再送(N-425)。未受諾・期限切れの招待だけ owner/admin が送り直せる。
 * 同じ行を使い回す(新規行を作らず、作成日時などの履歴を残す)。旧トークンは
 * 上書きで失効し、新トークンの期限は7日(N-432)。二重押し・同時再送は後勝ちで、
 * 生き残るのは最後に発行した1つだけ。旧リンクの受諾は410で再発行を案内する。
 * 自動再送はしない(要件 v6-30 §9-2)。管理者が対象を確かめて押す運用にする。
 */
staff.post('/api/staff/:id/resend-invitation', requireRole('owner', 'admin'), async (c) => {
  const id = c.req.param('id');
  const target = await getStaffById(c.env.DB, id);
  if (!target || !isInCurrentTenant(c, target)) return c.json({ success: false, error: 'Staff member not found' }, 404);
  if (target.invite_status === 'active') {
    return c.json({ success: false, error: 'このユーザーはすでに利用を開始しています。招待の再送はできません。' }, 409);
  }
  if (!target.email) {
    return c.json({ success: false, error: 'メールアドレスがないため招待を再送できません。' }, 400);
  }
  try {
    const token = randomToken();
    const updated = await updateStaffMember(c.env.DB, id, {
      invite_token_hash: await sha256Hex(token),
      invite_expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    });
    if (!updated) return c.json({ success: false, error: 'Staff member not found' }, 404);
    try {
      /*
       * どこで止まっているかで送る便りを変える。メール確認まで済んでいる人
       * (pending_line)へ確認メールを送り直しても、確認画面は pending_email
       * のときしか先へ進めないので、LINE連携の案内が誰にも届かないまま
       * 「送った」ことになる。止まっている一歩のほうを送り直す。
       */
      if (updated.invite_status === 'pending_line') {
        await sendStaffLineLinkEmail(c.env, {
          name: updated.name, email: updated.email ?? target.email,
          lineUrl: `${new URL(c.req.url).origin}/api/auth/line?invite=${encodeURIComponent(token)}`,
        });
      } else {
        await sendStaffInviteEmail(c.env, {
          name: updated.name, email: updated.email ?? target.email,
          verifyUrl: invitationConfirmationUrl(c, token),
        });
      }
    } catch (error) {
      console.error('POST /api/staff/:id/resend-invitation error:', error);
      return c.json({ success: false, error: '招待メールを送信できませんでした。時間をおいて、もう一度送り直してください。' }, 500);
    }
    return c.json({ success: true, data: await serializeStaff(c.env.DB, updated) });
  } catch (error) {
    console.error('POST /api/staff/:id/resend-invitation error:', error);
    return c.json({ success: false, error: '招待を再送できませんでした' }, 500);
  }
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
  const keyError = invalidPermissionKeys(body.permissionKeys) ?? invalidNotificationPreferences(body.notificationPreferences);
  if (keyError) return c.json({ success: false, error: keyError }, 400);
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
  const authenticationPolicyChanged =
    body.role !== undefined ||
    body.isActive !== undefined ||
    body.lineLinked === false ||
    body.permissionKeys !== undefined ||
    body.assignedLineAccountId !== undefined ||
    body.canAccessDescendantAccounts !== undefined ||
    body.accountScope !== undefined;
  if (updated && authenticationPolicyChanged) {
    await revokeStaffAuthentication(c.env.DB, id);
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
  if (c.get('staff').id !== id) return c.json({ success: false, error: '自分の二段階認証だけ設定できます' }, 403);
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
  if (c.get('staff').id !== id) return c.json({ success: false, error: '自分の二段階認証だけ設定できます' }, 403);
  const key = totpMasterKey(c);
  if (!key) return c.json({ success: false, error: '二段階認証の暗号鍵が設定されていません' }, 503);
  if (!member?.totp_pending_secret_enc) return c.json({ success: false, error: '先にQRコードを表示してください' }, 400);
  const body = await c.req.json<{ code?: string }>().catch(() => ({} as { code?: string }));
  const attempt = await reserveTwoFactorSetupAttempt(c.env.DB, id);
  if (!attempt) return c.json({ success: false, error: TWO_FACTOR_ATTEMPT_LIMIT_ERROR }, 429);
  const encrypted = member.totp_pending_secret_enc;
  const result = await verifyTotp(await decryptTotpSecret(encrypted, key), body.code ?? '');
  if (!result.valid) {
    return c.json(
      { success: false, error: attempt.attempts >= attempt.maxAttempts ? TWO_FACTOR_ATTEMPT_LIMIT_ERROR : '認証コードが正しくありません' },
      attempt.attempts >= attempt.maxAttempts ? 429 : 400,
    );
  }
  const updated = await updateStaffMember(c.env.DB, id, {
    totp_secret_enc: encrypted,
    totp_pending_secret_enc: null,
    totp_enabled_at: new Date().toISOString(),
    totp_last_used_step: null,
  });
  if (updated) {
    await clearTwoFactorSetupAttempts(c.env.DB, id);
    await revokeStaffAuthentication(c.env.DB, id);
  }
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
  if (updated) await revokeStaffAuthentication(c.env.DB, id);
  return updated ? c.json({ success: true, data: await serializeStaff(c.env.DB, updated) }) : c.json({ success: false, error: 'Staff member not found' }, 404);
});

staff.delete('/api/staff/:id', requireRole('owner', 'admin'), async (c) => {
  const id = c.req.param('id');
  if (id === c.get('staff').id) return c.json({ success: false, error: '自分自身は利用停止できません' }, 400);
  const target = await getStaffById(c.env.DB, id);
  if (!target || !isInCurrentTenant(c, target)) return c.json({ success: false, error: 'Staff member not found' }, 404);
  const guard = await guardLastAdmin(c.env.DB, target, currentTenantId(c), { isActive: false, self: false });
  if (guard) return c.json({ success: false, error: guard }, 400);
  const updated = await updateStaffMember(c.env.DB, id, { is_active: 0 });
  await revokeStaffAuthentication(c.env.DB, id);
  return updated
    ? c.json({ success: true, data: await serializeStaff(c.env.DB, updated) })
    : c.json({ success: false, error: 'Staff member not found' }, 404);
});

export { staff };
