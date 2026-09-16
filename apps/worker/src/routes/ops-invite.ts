import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  consumePlatformAdminInvite,
  getPlatformAdminInviteByTokenHash,
  getPlatformAdminRecord,
  getStaffById,
  recordLoginAudit,
  setPlatformAdminActivationState,
  toJstString,
  updateStaffMember,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { sha256Hex } from '../middleware/auth.js';
import { resolveAdminAuthConfig } from '../middleware/admin-auth-config.js';
import { clientIp, issueSession } from '../services/admin-session.js';
import { hashPassword, validatePasswordPolicy } from '../services/password-hash.js';

/**
 * 運営メンバーの招待を受ける（★V6 37-10-A）。ログイン前に開く公開の口。
 *
 * 流れ: メールの URL（#invite=…）→ check で状態を見る → accept で
 *   - パスワード未設定の人: 名前とパスワードを設定してログイン
 *   - 設定済みの人: そのままログイン
 * → platform_admins を awaiting_totp に進める → 画面は 2要素認証の設定（37-10-B）へ。
 * 2要素認証の確認（/api/staff/:id/two-factor/confirm）が通った時点で active になる。
 */
export const opsInvite = new Hono<Env>();

const NAME_MAX = 60;
type InviteState = 'valid' | 'invalid' | 'expired' | 'used';

async function loadInvite(c: Context<Env>, token: string) {
  if (!token || token.length > 512) return { state: 'invalid' as InviteState, invite: null, staff: null };
  const invite = await getPlatformAdminInviteByTokenHash(c.env.DB, await sha256Hex(token));
  if (!invite) return { state: 'invalid' as InviteState, invite: null, staff: null };
  if (invite.consumed_at) return { state: 'used' as InviteState, invite, staff: null };
  if (Date.parse(invite.expires_at) < Date.now()) return { state: 'expired' as InviteState, invite, staff: null };
  const staff = await getStaffById(c.env.DB, invite.staff_id);
  if (!staff) return { state: 'invalid' as InviteState, invite, staff: null };
  const record = await getPlatformAdminRecord(c.env.DB, staff.id);
  if (!record || record.is_active !== 1) return { state: 'invalid' as InviteState, invite, staff: null };
  return { state: 'valid' as InviteState, invite, staff };
}

const STATE_MESSAGE: Record<Exclude<InviteState, 'valid'>, string> = {
  invalid: 'この招待は見つかりません。招待した運営メンバーに確認してください',
  expired: 'この招待は期限切れです。招待した運営メンバーに送り直しを依頼してください',
  used: 'この招待はすでに使われています。ログインしてください',
};

function readToken(c: Context<Env>, body?: Record<string, unknown>): string {
  const fromBody = typeof body?.token === 'string' ? body.token : '';
  return (fromBody || c.req.query('token') || '').trim();
}

opsInvite.get('/api/auth/ops-invite/check', async (c) => {
  const { state, staff } = await loadInvite(c, readToken(c));
  if (state !== 'valid' || !staff) {
    return c.json({ success: false, error: STATE_MESSAGE[state as Exclude<InviteState, 'valid'>], code: state }, state === 'invalid' ? 404 : 410);
  }
  return c.json({
    success: true,
    data: {
      email: staff.email,
      name: staff.name,
      // パスワードが無い人は名前とパスワードを決めてもらう
      needsPassword: !staff.password_hash,
    },
  });
});

opsInvite.post('/api/auth/ops-invite/accept', async (c) => {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) return c.json({ success: false, error: config.misconfigured }, 500);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const { state, invite, staff } = await loadInvite(c, readToken(c, body));
  if (state !== 'valid' || !staff || !invite) {
    return c.json({ success: false, error: STATE_MESSAGE[state as Exclude<InviteState, 'valid'>], code: state }, state === 'invalid' ? 404 : 410);
  }

  const now = new Date();
  const updates: Record<string, unknown> = {
    is_active: 1,
    invite_status: 'active',
    invite_token_hash: null,
    invite_expires_at: null,
    email_verified_at: toJstString(now),
  };
  if (!staff.password_hash) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const errors: Record<string, string> = {};
    if (!name) errors.name = 'お名前を入力してください';
    else if (name.length > NAME_MAX) errors.name = `お名前は${NAME_MAX}文字以内で入力してください`;
    const passwordError = validatePasswordPolicy(password);
    if (passwordError) errors.password = passwordError;
    if (Object.keys(errors).length) return c.json({ success: false, error: Object.values(errors)[0], errors }, 400);
    updates.name = name;
    updates.password_hash = await hashPassword(password);
    updates.password_updated_at = toJstString(now);
  }

  // 二重送信で 2 回進めないよう、先に招待を消費する。
  if (!(await consumePlatformAdminInvite(c.env.DB, invite.id))) {
    return c.json({ success: false, error: STATE_MESSAGE.used, code: 'used' }, 410);
  }
  const updated = await updateStaffMember(c.env.DB, staff.id, updates);
  if (!updated) return c.json({ success: false, error: '登録を進められませんでした' }, 500);
  await setPlatformAdminActivationState(c.env.DB, staff.id, 'awaiting_totp');

  const session = await issueSession(c, staff.id, config.sameSite);
  await recordLoginAudit(c.env.DB, {
    adminUserId: staff.id,
    action: 'login',
    ip: clientIp(c),
    userAgent: c.req.header('user-agent') ?? null,
  });
  return c.json({
    success: true,
    data: {
      next: 'two-factor-setup',
      sessionToken: config.crossSite ? session.sessionToken : undefined,
    },
    csrfToken: session.csrfToken,
  });
});
