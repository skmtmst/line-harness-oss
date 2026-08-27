import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../index.js';
import {
  ADMIN_AUTH_COOKIE,
  ADMIN_SESSION_BEARER_PREFIX,
  CSRF_COOKIE,
  adminSessionCookie,
  adminSessionTokenFromCookie,
  adminSessionTokenHashFromRequest,
  authenticateApiToken,
  csrfCookie,
  csrfTokenFromCookie,
  expiredCookie,
  SESSION_MAX_AGE,
  sha256Hex,
} from '../middleware/auth.js';
import { resolveAdminAuthConfig } from '../middleware/admin-auth-config.js';
import { recordLoginAudit } from '@line-crm/db';
import {
  createAdminSession,
  createTwoFactorChallenge,
  claimStaffTotpStep,
  clearAdminStepUpFailures,
  countRecentAdminStepUpFailures,
  createAdminStepUpGrant,
  deleteExpiredAdminStepUpGrants,
  deleteOldAdminStepUpFailures,
  deleteAdminSession,
  deleteExpiredTwoFactorChallenges,
  deleteTwoFactorChallenge,
  getStaffById,
  getStaffByInviteTokenHash,
  getStaffByLineUserId,
  getStaffByLineUserIdIncludingInactive,
  getTwoFactorChallenge,
  incrementTwoFactorChallengeAttempts,
  recordAdminStepUpFailure,
  updateStaffMember,
} from '@line-crm/db';
import { decryptTotpSecret, verifyTotp } from '../lib/totp.js';

export const adminAuth = new Hono<Env>();

const OAUTH_STATE_COOKIE = 'lh_line_state';
const OAUTH_NONCE_COOKIE = 'lh_line_nonce';
const OAUTH_VERIFIER_COOKIE = 'lh_line_verifier';
const OAUTH_INVITE_COOKIE = 'lh_line_invite';
const OAUTH_MAX_AGE = 600;
const TWO_FACTOR_CHALLENGE_MAX_AGE = 5 * 60 * 1000;
const TWO_FACTOR_MAX_ATTEMPTS = 5;
const STEP_UP_MAX_AGE = 5 * 60 * 1000;
const STEP_UP_FAILURE_WINDOW = 5 * 60 * 1000;

function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function oauthCookie(name: string, value: string, maxAge = OAUTH_MAX_AGE): string {
  return `${name}=${encodeURIComponent(value)}; Path=/api/auth/line; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(value.join('=')); } catch { return null; }
    }
  }
  return null;
}

function callbackUrl(c: Context<Env>): string {
  return `${new URL(c.req.url).origin}/api/auth/line/callback`;
}

function adminLoginUrl(c: Context<Env>, error?: string): string {
  const base = c.env.ADMIN_PUBLIC_URL?.replace(/\/+$/, '');
  if (!base) throw new Error('ADMIN_PUBLIC_URL is not configured');
  return `${base}/login${error ? `?error=${encodeURIComponent(error)}` : ''}`;
}

function twoFactorLoginUrl(c: Context<Env>, challengeToken: string): string {
  const base = c.env.ADMIN_PUBLIC_URL?.replace(/\/+$/, '');
  if (!base) throw new Error('ADMIN_PUBLIC_URL is not configured');
  const url = new URL(`${base}/login/two-factor`);
  url.hash = new URLSearchParams({ lh_2fa: challengeToken }).toString();
  return url.toString();
}

async function issueSession(c: Context<Env>, staffId: string, sameSite: 'Strict' | 'Lax' | 'None') {
  const sessionToken = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  await createAdminSession(c.env.DB, await sha256Hex(sessionToken), staffId, expiresAt);
  const csrfToken = randomToken();
  c.header('Set-Cookie', adminSessionCookie(sessionToken, sameSite), { append: true });
  c.header('Set-Cookie', csrfCookie(csrfToken, sameSite), { append: true });
  return { csrfToken, sessionToken };
}

adminAuth.get('/api/auth/line', async (c) => {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) return c.json({ success: false, error: config.misconfigured }, 500);
  if (!c.env.LINE_LOGIN_CHANNEL_ID || !c.env.LINE_LOGIN_CHANNEL_SECRET) {
    return c.json({ success: false, error: 'LINE Login is not configured' }, 500);
  }

  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  ))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  c.header('Set-Cookie', oauthCookie(OAUTH_STATE_COOKIE, state), { append: true });
  c.header('Set-Cookie', oauthCookie(OAUTH_NONCE_COOKIE, nonce), { append: true });
  c.header('Set-Cookie', oauthCookie(OAUTH_VERIFIER_COOKIE, verifier), { append: true });
  const invite = c.req.query('invite');
  if (invite) c.header('Set-Cookie', oauthCookie(OAUTH_INVITE_COOKIE, invite), { append: true });

  const authorize = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: c.env.LINE_LOGIN_CHANNEL_ID,
    redirect_uri: callbackUrl(c),
    state,
    scope: 'openid profile',
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return c.redirect(authorize.toString());
});

adminAuth.get('/api/auth/line/callback', async (c) => {
  const cookies = c.req.header('Cookie');
  const expectedState = readCookie(cookies, OAUTH_STATE_COOKIE);
  const nonce = readCookie(cookies, OAUTH_NONCE_COOKIE);
  const verifier = readCookie(cookies, OAUTH_VERIFIER_COOKIE);
  const invite = readCookie(cookies, OAUTH_INVITE_COOKIE);
  const state = c.req.query('state');
  const code = c.req.query('code');

  for (const name of [OAUTH_STATE_COOKIE, OAUTH_NONCE_COOKIE, OAUTH_VERIFIER_COOKIE, OAUTH_INVITE_COOKIE]) {
    c.header('Set-Cookie', oauthCookie(name, '', 0), { append: true });
  }

  if (!code || !state || !expectedState || state !== expectedState || !nonce || !verifier) {
    return c.redirect(adminLoginUrl(c, 'invalid_state'));
  }

  try {
    const tokenResponse = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl(c),
        client_id: c.env.LINE_LOGIN_CHANNEL_ID,
        client_secret: c.env.LINE_LOGIN_CHANNEL_SECRET,
        code_verifier: verifier,
      }),
    });
    if (!tokenResponse.ok) return c.redirect(adminLoginUrl(c, 'line_login_failed'));
    const tokens = await tokenResponse.json<{ id_token?: string }>();
    if (!tokens.id_token) return c.redirect(adminLoginUrl(c, 'line_login_failed'));

    const verifyResponse = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token: tokens.id_token,
        client_id: c.env.LINE_LOGIN_CHANNEL_ID,
        nonce,
      }),
    });
    if (!verifyResponse.ok) return c.redirect(adminLoginUrl(c, 'line_login_failed'));
    const profile = await verifyResponse.json<{ sub?: string }>();
    if (!profile.sub) return c.redirect(adminLoginUrl(c, 'line_login_failed'));

    let staff = await getStaffByLineUserId(c.env.DB, profile.sub);
    if (!staff && invite) {
      const invited = await getStaffByInviteTokenHash(c.env.DB, await sha256Hex(invite));
      if (
        invited?.invite_status === 'pending_line' &&
        invited.invite_expires_at &&
        Date.parse(invited.invite_expires_at) >= Date.now()
      ) {
        // 同じLINEアカウントを握ったままの古い行があると、line_user_id の
        // ユニーク制約で連携が落ちる。招待の方が新しい意思なので、古い方の
        // 連携を先に外す。行そのものは消さない（権限の記録は残す）。
        const previous = await getStaffByLineUserIdIncludingInactive(c.env.DB, profile.sub);
        if (previous && previous.id !== invited.id) {
          await updateStaffMember(c.env.DB, previous.id, { line_user_id: null, line_linked_at: null });
        }
        staff = await updateStaffMember(c.env.DB, invited.id, {
          line_user_id: profile.sub,
          is_active: 1,
          invite_status: 'active',
          invite_token_hash: null,
          invite_expires_at: null,
          line_linked_at: new Date().toISOString(),
        });
      }
    }
    if (!staff) return c.redirect(adminLoginUrl(c, 'not_authorized'));

    const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
    if (config.misconfigured) return c.redirect(adminLoginUrl(c, 'configuration_error'));
    if (staff.totp_enabled_at && staff.totp_secret_enc) {
      if (!c.env.TOTP_ENCRYPTION_KEY) return c.redirect(adminLoginUrl(c, 'configuration_error'));
      const challengeToken = randomToken();
      await deleteExpiredTwoFactorChallenges(c.env.DB, new Date().toISOString());
      await createTwoFactorChallenge(
        c.env.DB,
        await sha256Hex(challengeToken),
        staff.id,
        new Date(Date.now() + TWO_FACTOR_CHALLENGE_MAX_AGE).toISOString(),
      );
      return c.redirect(twoFactorLoginUrl(c, challengeToken));
    }
    const session = await issueSession(c, staff.id, config.sameSite);
    const adminUrl = new URL(c.env.ADMIN_PUBLIC_URL!.replace(/\/+$/, ''));
    if (config.crossSite) {
      adminUrl.hash = new URLSearchParams({
        lh_session: session.sessionToken,
        lh_csrf: session.csrfToken,
      }).toString();
    }
    await recordLoginAudit(c.env.DB, {
      adminUserId: staff.id,
      action: 'login',
      ip: clientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
    });
    return c.redirect(adminUrl.toString());
  } catch (error) {
    console.error('[admin-auth] LINE Login callback failed', error);
    return c.redirect(adminLoginUrl(c, 'line_login_failed'));
  }
});

adminAuth.post('/api/auth/two-factor/verify', async (c) => {
  const body = await c.req.json<{ challengeToken?: string; code?: string }>()
    .catch(() => ({} as { challengeToken?: string; code?: string }));
  const challengeToken = body.challengeToken?.trim() ?? '';
  const code = body.code?.trim() ?? '';
  if (!challengeToken || !/^\d{6}$/.test(code)) {
    return c.json({ success: false, error: '6桁の認証コードを入力してください' }, 400);
  }

  const tokenHash = await sha256Hex(challengeToken);
  const challenge = await getTwoFactorChallenge(c.env.DB, tokenHash);
  if (!challenge || Date.parse(challenge.expires_at) <= Date.now()) {
    if (challenge) await deleteTwoFactorChallenge(c.env.DB, tokenHash);
    return c.json({ success: false, error: '認証の有効時間が切れました。LINEログインからやり直してください' }, 401);
  }
  if (challenge.attempts >= TWO_FACTOR_MAX_ATTEMPTS) {
    await deleteTwoFactorChallenge(c.env.DB, tokenHash);
    return c.json({ success: false, error: '入力回数を超えました。LINEログインからやり直してください' }, 429);
  }

  const staff = await getStaffById(c.env.DB, challenge.staff_id);
  const masterKey = c.env.TOTP_ENCRYPTION_KEY;
  if (!staff?.is_active || !staff.totp_secret_enc || !staff.totp_enabled_at || !masterKey) {
    await deleteTwoFactorChallenge(c.env.DB, tokenHash);
    return c.json({ success: false, error: '二段階認証を確認できません' }, 401);
  }

  const verified = await verifyTotp(
    await decryptTotpSecret(staff.totp_secret_enc, masterKey),
    code,
    Date.now(),
    staff.totp_last_used_step,
  );
  if (!verified.valid || verified.step === null) {
    await incrementTwoFactorChallengeAttempts(c.env.DB, tokenHash);
    return c.json({ success: false, error: '認証コードが正しくありません' }, 400);
  }

  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) return c.json({ success: false, error: config.misconfigured }, 500);
  if (!await claimStaffTotpStep(c.env.DB, staff.id, verified.step)) {
    await deleteTwoFactorChallenge(c.env.DB, tokenHash);
    return c.json({ success: false, error: 'この認証コードは使用済みです。次のコードを入力してください' }, 409);
  }
  await deleteTwoFactorChallenge(c.env.DB, tokenHash);
  const session = await issueSession(c, staff.id, config.sameSite);
  await recordLoginAudit(c.env.DB, {
    adminUserId: staff.id,
    action: 'login',
    ip: clientIp(c),
    userAgent: c.req.header('user-agent') ?? null,
  });
  return c.json({
    success: true,
    // Same-site deployments keep the credential HttpOnly. Only the documented
    // cross-site fallback hands the opaque session token to the SPA.
    data: { sessionToken: config.crossSite ? session.sessionToken : undefined },
    csrfToken: session.csrfToken,
  });
});

adminAuth.post('/api/auth/step-up', async (c) => {
  const body = await c.req.json<{
    code?: string;
    purpose?: 'operation-stop' | 'operation-restore';
  }>().catch(() => ({} as { code?: string; purpose?: 'operation-stop' | 'operation-restore' }));
  const code = body.code?.trim() ?? '';
  if (!/^\d{6}$/.test(code)) {
    return c.json({ success: false, error: '6桁の認証コードを入力してください' }, 400);
  }
  if (body.purpose !== 'operation-stop' && body.purpose !== 'operation-restore') {
    return c.json({ success: false, error: '再確認する操作を指定してください' }, 400);
  }

  const authenticated = c.get('staff');
  const sessionTokenHash = await adminSessionTokenHashFromRequest(c);
  if (!authenticated || !sessionTokenHash || authenticated.id === 'env-owner') {
    return c.json({
      success: false,
      error: '高危険操作は、二段階認証を設定した通常のログインセッションから実行してください',
    }, 403);
  }

  const staff = await getStaffById(c.env.DB, authenticated.id);
  const masterKey = c.env.TOTP_ENCRYPTION_KEY;
  if (!staff?.is_active || !staff.totp_secret_enc || !staff.totp_enabled_at || !masterKey) {
    return c.json({
      success: false,
      error: '二段階認証が未設定です。ログインユーザー画面で設定してから実行してください',
    }, 403);
  }

  const now = new Date();
  const failureWindowStart = new Date(now.getTime() - STEP_UP_FAILURE_WINDOW).toISOString();
  await deleteOldAdminStepUpFailures(c.env.DB, failureWindowStart);
  if (await countRecentAdminStepUpFailures(c.env.DB, sessionTokenHash, failureWindowStart) >= TWO_FACTOR_MAX_ATTEMPTS) {
    return c.json({
      success: false,
      error: '入力回数を超えました。5分待ってからもう一度確認してください',
    }, 429);
  }

  const verified = await verifyTotp(
    await decryptTotpSecret(staff.totp_secret_enc, masterKey),
    code,
    Date.now(),
    staff.totp_last_used_step,
  );
  if (!verified.valid || verified.step === null) {
    await recordAdminStepUpFailure(c.env.DB, {
      id: crypto.randomUUID(),
      staffId: staff.id,
      sessionTokenHash,
      occurredAt: now.toISOString(),
    });
    return c.json({ success: false, error: '認証コードが正しくありません' }, 400);
  }
  if (!await claimStaffTotpStep(c.env.DB, staff.id, verified.step)) {
    return c.json({ success: false, error: 'この認証コードは使用済みです。次のコードを入力してください' }, 409);
  }

  await clearAdminStepUpFailures(c.env.DB, sessionTokenHash);
  const expiresAt = new Date(now.getTime() + STEP_UP_MAX_AGE).toISOString();
  const stepUpToken = randomToken();
  await deleteExpiredAdminStepUpGrants(c.env.DB, now.toISOString());
  await createAdminStepUpGrant(c.env.DB, {
    tokenHash: await sha256Hex(stepUpToken),
    staffId: staff.id,
    sessionTokenHash,
    purpose: body.purpose,
    expiresAt,
    createdAt: now.toISOString(),
  });
  return c.json({
    success: true,
    data: { stepUpToken, purpose: body.purpose, expiresAt },
  });
});

/**
 * POST /api/auth/login
 *
 * Validates the API key, then issues:
 *   - lh_admin_session (HttpOnly) — the credential, never exposed to JS.
 *   - lh_csrf (readable) — the double-submit CSRF token, also returned in the
 *     body so a cross-site SPA (which cannot read the API's cookie) can echo it
 *     back via the X-CSRF-Token header.
 *
 * Refuses with a clear error when the topology cannot deliver the cookie,
 * turning the silent "login breaks after deploy" failure into an actionable
 * configuration error.
 */
/**
 * 接続元のIP。
 *
 * Cloudflare が付けるヘッダを優先する。前段のプロキシが入る構成でも
 * 何かしら残るよう、順に見て最初に見つかったものを使う。
 */
function clientIp(c: { req: { header: (name: string) => string | undefined } }): string | null {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    null
  );
}

adminAuth.post('/api/auth/login', async (c) => {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) {
    console.error('[admin-auth] refused login — misconfigured topology:', config.misconfigured);
    return c.json({ success: false, error: config.misconfigured }, 500);
  }

  const body = await c.req
    .json<{ apiKey?: string }>()
    .catch(() => ({}) as { apiKey?: string });
  const apiKey = body.apiKey?.trim() ?? '';
  const staff = await authenticateApiToken(c, apiKey || null);

  if (!staff) {
    // 失敗も残す。誰が入れたかだけでなく、誰が入ろうとしたかも
    // 分からないと、鍵が漏れたときに気づけない。
    await recordLoginAudit(c.env.DB, {
      action: 'fail',
      ip: clientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
      result: 'unauthorized',
    });
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  let csrfToken: string;
  if (staff.id === 'env-owner') {
    // Emergency recovery only. The normal UI never asks for or exposes this key.
    csrfToken = crypto.randomUUID();
    c.header('Set-Cookie', adminSessionCookie(apiKey, config.sameSite), { append: true });
    c.header('Set-Cookie', csrfCookie(csrfToken, config.sameSite), { append: true });
  } else {
    csrfToken = (await issueSession(c, staff.id, config.sameSite)).csrfToken;
  }
  await recordLoginAudit(c.env.DB, {
    adminUserId: staff.id,
    action: 'login',
    ip: clientIp(c),
    userAgent: c.req.header('user-agent') ?? null,
  });
  return c.json({ success: true, data: staff, csrfToken });
});

/**
 * POST /api/auth/logout — clears both cookies. No CSRF required: clearing your
 * own session is not a meaningful CSRF target, and this keeps logout resilient
 * even if the CSRF token was lost client-side.
 */
adminAuth.post('/api/auth/logout', async (c) => {
  // 誰がログアウトしたかは、この時点では staff から取れる場合と
  // 取れない場合がある。取れなければ null で残す。記録が無いより
  // 「誰かがログアウトした」の方が手がかりになる。
  await recordLoginAudit(c.env.DB, {
    adminUserId: c.get('staff')?.id ?? null,
    action: 'logout',
    ip: clientIp(c),
  });
  const token = adminSessionTokenFromCookie(c);
  if (token) await deleteAdminSession(c.env.DB, await sha256Hex(token));
  const authorization = c.req.header('Authorization') || '';
  const bearerPrefix = `Bearer ${ADMIN_SESSION_BEARER_PREFIX}`;
  if (authorization.startsWith(bearerPrefix)) {
    await deleteAdminSession(c.env.DB, await sha256Hex(authorization.slice(bearerPrefix.length)));
  }
  const { sameSite } = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  c.header('Set-Cookie', expiredCookie(ADMIN_AUTH_COOKIE, sameSite), { append: true });
  c.header('Set-Cookie', expiredCookie(CSRF_COOKIE, sameSite), { append: true });
  return c.json({ success: true, data: null });
});

/**
 * GET /api/auth/session — returns the authenticated staff (set by the auth
 * middleware) plus the current CSRF token, refreshing the CSRF cookie if it is
 * missing (e.g. after a reload that dropped the in-memory token). This lets the
 * SPA recover the CSRF token without forcing a re-login.
 */
adminAuth.get('/api/auth/session', async (c) => {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  let csrfToken = csrfTokenFromCookie(c);
  if (!csrfToken) {
    csrfToken = crypto.randomUUID();
    c.header('Set-Cookie', csrfCookie(csrfToken, config.sameSite), { append: true });
  }
  return c.json({ success: true, data: c.get('staff'), csrfToken });
});
