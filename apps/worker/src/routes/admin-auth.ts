import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../index.js';
import {
  ADMIN_AUTH_COOKIE,
  ADMIN_SESSION_BEARER_PREFIX,
  CSRF_COOKIE,
  SESSION_DEFAULT_MAX_AGE,
  SESSION_REMEMBER_MAX_AGE,
  adminSessionCookie,
  adminSessionTokenFromCookie,
  adminSessionTokenHashFromRequest,
  authenticateApiToken,
  csrfCookie,
  csrfTokenFromCookie,
  expiredCookie,
  sha256Hex,
} from '../middleware/auth.js';
import { clientIp, issueSession, maskIpPrefix, randomToken } from '../services/admin-session.js';
import { resolveAdminAuthConfig } from '../middleware/admin-auth-config.js';
import { recordAuditEvent, recordLoginAudit } from '@line-crm/db';
import {
  activatePlatformAdminIfAwaitingTotp,
  claimStaffTotpStep,
  claimTotpPendingSecret,
  clearStepUpAttempts,
  createStepUpGrant,
  deleteAdminSession,
  deleteAdminSessionForStaff,
  deleteOtherAdminSessions,
  deleteTwoFactorChallenge,
  listAdminSessionsByStaff,
  markAdminSessionStepUp,
  getAdminSessionByTokenHash,
  getStaffById,
  getStaffByInviteTokenHash,
  getStaffByLineUserId,
  getStaffByLineUserIdIncludingInactive,
  getActiveImpersonation,
  getPlatformAdminRecord,
  getTwoFactorChallenge,
  incrementTwoFactorChallengeAttempts,
  reserveStepUpAttempt,
  stepUpAttemptRetryAfterSeconds,
  updateStaffMember,
} from '@line-crm/db';
import { buildTotpUri, decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotp } from '../lib/totp.js';
import { isStepUpPurpose } from '../lib/step-up.js';
import { verifyPassword } from '../services/password-hash.js';
import { toImpersonationContext } from '../middleware/impersonation.js';
import { candidateFromStaffRow, isPlatformAdmin, isPlatformAdminRow } from '../middleware/platform-admin.js';

export const adminAuth = new Hono<Env>();

const OAUTH_STATE_COOKIE = 'lh_line_state';
const OAUTH_NONCE_COOKIE = 'lh_line_nonce';
const OAUTH_VERIFIER_COOKIE = 'lh_line_verifier';
const OAUTH_INVITE_COOKIE = 'lh_line_invite';
/** ログイン後の戻り先。'ops' のときだけ運営コンソールへ（★V6 37-1）。 */
const OAUTH_NEXT_COOKIE = 'lh_line_next';
/** 「7日間ログインを保持」の選択をOAuth往復のあいだ保持するための印。 */
const OAUTH_REMEMBER_COOKIE = 'lh_line_remember';
const OAUTH_MAX_AGE = 600;
const TWO_FACTOR_MAX_ATTEMPTS = 5;
const STEP_UP_ATTEMPT_LIMIT_ERROR = '入力回数を超えました。しばらく待ってからやり直してください';

/*
 * R503: 入力上限の429には待ち秒数を付ける。画面は「約N分待ってから」と出す。
 * Retry-After（秒）も付け、機械的な再試行の目安にする。本文は利用者向けの
 * 回復案内だけ（内部情報は入れない）。
 */
async function stepUpRateLimitResponse(c: Context<Env>, staffId: string) {
  const retryAfterSeconds = await stepUpAttemptRetryAfterSeconds(c.env.DB, staffId);
  return c.json(
    { success: false, error: STEP_UP_ATTEMPT_LIMIT_ERROR, data: { retryAfterSeconds } },
    429,
    { 'Retry-After': String(retryAfterSeconds) },
  );
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

/**
 * 管理画面ログイン用のLINE Loginチャネル。
 *
 * `LINE_LOGIN_CHANNEL_ID` は会員向けLIFF連携の既定チャネルも兼ねているため
 * （`routes/liff.ts`）、他社向けサービスの入口だけを別プロバイダーの
 * チャネルへ移せるように、管理者ログイン専用の設定を先に見る。
 * 未設定なら従来どおり共通のチャネルを使うので、設定を入れるまで挙動は変わらない。
 */
function adminLoginChannel(env: Env['Bindings']): { id: string; secret: string } {
  return {
    id: env.ADMIN_LINE_LOGIN_CHANNEL_ID?.trim() || env.LINE_LOGIN_CHANNEL_ID,
    secret: env.ADMIN_LINE_LOGIN_CHANNEL_SECRET?.trim() || env.LINE_LOGIN_CHANNEL_SECRET,
  };
}

function adminLoginUrl(c: Context<Env>, error?: string, next?: string | null): string {
  const base = c.env.ADMIN_PUBLIC_URL?.replace(/\/+$/, '');
  if (!base) throw new Error('ADMIN_PUBLIC_URL is not configured');
  const path = next === 'ops' ? '/ops/login' : '/login';
  return `${base}${path}${error ? `?error=${encodeURIComponent(error)}` : ''}`;
}

function authFailureDetail(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'UnknownError', message: 'Unknown failure' };
}

function logAuthFailure(branch: string, error: unknown): void {
  console.error('[admin-auth] authentication branch failed', {
    branch,
    ...authFailureDetail(error),
  });
}

async function recordLoginAuditBestEffort(c: Context<Env>, staffId: string): Promise<void> {
  try {
    await recordLoginAudit(c.env.DB, {
      adminUserId: staffId,
      action: 'login',
      ip: clientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
    });
  } catch (error) {
    // 監査台帳の一時障害で、発行済みセッションや認証成功を失敗扱いにしない。
    // Cookie・OAuth code・token・LINE user id はログへ出さない。
    logAuthFailure('recordLoginAudit', error);
  }
}

adminAuth.get('/api/auth/line', async (c) => {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) return c.json({ success: false, error: config.misconfigured }, 500);
  const channel = adminLoginChannel(c.env);
  if (!channel.id || !channel.secret) {
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
  const next = c.req.query('next');
  if (next === 'ops') c.header('Set-Cookie', oauthCookie(OAUTH_NEXT_COOKIE, next), { append: true });
  if (c.req.query('remember') === '1') c.header('Set-Cookie', oauthCookie(OAUTH_REMEMBER_COOKIE, '1'), { append: true });

  const authorize = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: channel.id,
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
  const next = readCookie(cookies, OAUTH_NEXT_COOKIE);
  const remember = readCookie(cookies, OAUTH_REMEMBER_COOKIE) === '1';
  const state = c.req.query('state');
  const code = c.req.query('code');

  for (const name of [OAUTH_STATE_COOKIE, OAUTH_NONCE_COOKIE, OAUTH_VERIFIER_COOKIE, OAUTH_INVITE_COOKIE, OAUTH_NEXT_COOKIE, OAUTH_REMEMBER_COOKIE]) {
    c.header('Set-Cookie', oauthCookie(name, '', 0), { append: true });
  }

  if (!code || !state || !expectedState || state !== expectedState || !nonce || !verifier) {
    return c.redirect(adminLoginUrl(c, 'invalid_state', next));
  }

  const channel = adminLoginChannel(c.env);

  try {
    const tokenResponse = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl(c),
        client_id: channel.id,
        client_secret: channel.secret,
        code_verifier: verifier,
      }),
    });
    if (!tokenResponse.ok) return c.redirect(adminLoginUrl(c, 'line_token_failed', next));
    const tokens = await tokenResponse.json<{ id_token?: string }>();
    if (!tokens.id_token) return c.redirect(adminLoginUrl(c, 'line_id_token_missing', next));

    const verifyResponse = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token: tokens.id_token,
        client_id: channel.id,
        nonce,
      }),
    });
    if (!verifyResponse.ok) return c.redirect(adminLoginUrl(c, 'line_verify_failed', next));
    const profile = await verifyResponse.json<{ sub?: string }>();
    if (!profile.sub) return c.redirect(adminLoginUrl(c, 'line_profile_missing', next));

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
        if (staff) staff = await getStaffById(c.env.DB, staff.id);
      }
    }
    if (!staff) return c.redirect(adminLoginUrl(c, 'not_authorized', next));

    // 運営コンソールへの LINE ログイン（★V6 37-1）。platform_admins に登録された
    // LINE ユーザーだけを通す。契約先の権限者や、契約者専用 LINE の友だちでは入れない。
    // platform_admins が空の間だけ、既定の統括のオーナーを互換で通す（初期登録のため）。
    if (next === 'ops') {
      /*
       * 自分自身の招待が保留中なら、互換判定で入れる立場（既定の統括のオーナー）
       * でも止める。メールのリンクから登録を完了させる（auth-email.ts と同じ）。
       * 他人の招待が保留中なだけの場合は互換判定を残す（誰も入れなくなるのを防ぐ）。
       */
      const pending = await getPlatformAdminRecord(c.env.DB, staff.id);
      const invited = pending?.is_active === 1 && pending.activation_state === 'invited';
      // 2要素認証待ちの人は通す（画面が設定へ案内する）。
      const awaitingTotp = pending?.is_active === 1 && pending.activation_state === 'awaiting_totp';
      if (invited) {
        return c.redirect(adminLoginUrl(c, 'not_authorized', next));
      }
      if (!awaitingTotp && !(await isPlatformAdminRow(c.env.DB, candidateFromStaffRow(staff)))) {
        return c.redirect(adminLoginUrl(c, 'not_authorized', next));
      }
    }

    const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
    if (config.misconfigured) return c.redirect(adminLoginUrl(c, 'configuration_error', next));
    // 2段階認証は削除済み。LINE認証後すぐセッション発行
    let session: Awaited<ReturnType<typeof issueSession>>;
    try {
      session = await issueSession(c, staff.id, config.sameSite, remember);
    } catch (error) {
      logAuthFailure('issueSession', error);
      return c.redirect(adminLoginUrl(c, 'line_login_failed', next));
    }
    const adminUrl = new URL(c.env.ADMIN_PUBLIC_URL!.replace(/\/+$/, ''));
    if (next === 'ops') adminUrl.pathname = `${adminUrl.pathname.replace(/\/+$/, '')}/ops`;
    if (config.crossSite) {
      adminUrl.hash = new URLSearchParams({
        lh_session: session.sessionToken,
        lh_csrf: session.csrfToken,
      }).toString();
    }
    await recordLoginAuditBestEffort(c, staff.id);
    return c.redirect(adminUrl.toString());
  } catch (error) {
    logAuthFailure('lineCallback', error);
    return c.redirect(adminLoginUrl(c, 'line_login_failed', next));
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
  if (!challenge || challenge.purpose !== 'verify' || Date.parse(challenge.expires_at) <= Date.now()) {
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
  let session: Awaited<ReturnType<typeof issueSession>>;
  try {
    session = await issueSession(c, staff.id, config.sameSite, challenge.remember === 1);
  } catch (error) {
    logAuthFailure('issueSession', error);
    return c.json({ success: false, error: 'ログイン状態を作成できませんでした。ログインからやり直してください' }, 500);
  }
  await recordLoginAuditBestEffort(c, staff.id);
  return c.json({
    success: true,
    // Same-site deployments keep the credential HttpOnly. Only the documented
    // cross-site fallback hands the opaque session token to the SPA.
    data: { sessionToken: config.crossSite ? session.sessionToken : undefined },
    csrfToken: session.csrfToken,
  });
});

/**
 * POST /api/auth/two-factor/setup — TOTP未登録の管理者向けの初回設定を始める。
 *
 * 通常セッションを持てない人が通るため、認証済みセッションではなく
 * setup 用途の合言葉だけで開ける。登録用の秘密をその場で発行して
 * provisioning URI を返す。
 */
adminAuth.post('/api/auth/two-factor/setup', async (c) => {
  const body = await c.req.json<{ challengeToken?: string }>()
    .catch(() => ({} as { challengeToken?: string }));
  const challengeToken = body.challengeToken?.trim() ?? '';
  if (!challengeToken) {
    return c.json({ success: false, error: '設定の合言葉がありません。ログインからやり直してください' }, 400);
  }

  const tokenHash = await sha256Hex(challengeToken);
  const challenge = await getTwoFactorChallenge(c.env.DB, tokenHash);
  if (!challenge || challenge.purpose !== 'setup' || Date.parse(challenge.expires_at) <= Date.now()) {
    if (challenge) await deleteTwoFactorChallenge(c.env.DB, tokenHash);
    return c.json({ success: false, error: '設定の有効時間が切れました。ログインからやり直してください' }, 401);
  }

  const staff = await getStaffById(c.env.DB, challenge.staff_id);
  const masterKey = c.env.TOTP_ENCRYPTION_KEY;
  if (!staff?.is_active || !masterKey) {
    return c.json({ success: false, error: '二段階認証を設定できません' }, 401);
  }
  if (staff.totp_enabled_at && staff.totp_secret_enc) {
    return c.json({ success: false, error: '二段階認証はすでに設定されています' }, 409);
  }

  /*
   * R509: 同じ合言葉への同時取得でも画面のQRと保存がずれないよう冪等にする。
   * 期限内は既発行の仮秘密を使い回す。競合で先に置かれた場合も、
   * 条件付き更新に負けた側は置かれた値を読み直して同じQRを返す。
   */
  const secret = await setupPendingTotpSecret(c.env.DB, staff.id, staff.totp_pending_secret_enc, masterKey);
  return c.json({
    success: true,
    data: {
      provisioningUri: buildTotpUri(secret, staff.email || staff.name),
      manualKey: secret.match(/.{1,4}/g)?.join(' ') ?? secret,
    },
  });
});

/** R509: 置ける仮秘密を1つに決める。既発行があればそれを、無ければ条件付きで置く。 */
async function setupPendingTotpSecret(
  db: Env['Bindings']['DB'],
  staffId: string,
  existingEnc: string | null | undefined,
  masterKey: string,
): Promise<string> {
  const existing = await readPendingTotpSecret(existingEnc, masterKey);
  if (existing) return existing;
  const secret = generateTotpSecret();
  const enc = await encryptTotpSecret(secret, masterKey);
  if (await claimTotpPendingSecret(db, staffId, enc)) return secret;
  const reread = await getStaffById(db, staffId);
  const winner = await readPendingTotpSecret(reread?.totp_pending_secret_enc, masterKey);
  if (winner) return winner;
  await updateStaffMember(db, staffId, { totp_pending_secret_enc: enc });
  return secret;
}

async function readPendingTotpSecret(
  enc: string | null | undefined,
  masterKey: string,
): Promise<string | null> {
  if (!enc) return null;
  try {
    return await decryptTotpSecret(enc, masterKey);
  } catch {
    return null;
  }
}

/**
 * POST /api/auth/two-factor/setup/confirm — 初回設定の確認。
 *
 * 認証アプリの6桁が合えばTOTPを有効にし、そのまま通常セッションを発行する。
 * 試行は合言葉ごとに5回まで。
 */
adminAuth.post('/api/auth/two-factor/setup/confirm', async (c) => {
  const body = await c.req.json<{ challengeToken?: string; code?: string }>()
    .catch(() => ({} as { challengeToken?: string; code?: string }));
  const challengeToken = body.challengeToken?.trim() ?? '';
  const code = body.code?.trim() ?? '';
  if (!challengeToken || !/^\d{6}$/.test(code)) {
    return c.json({ success: false, error: '6桁の認証コードを入力してください' }, 400);
  }

  const tokenHash = await sha256Hex(challengeToken);
  const challenge = await getTwoFactorChallenge(c.env.DB, tokenHash);
  if (!challenge || challenge.purpose !== 'setup' || Date.parse(challenge.expires_at) <= Date.now()) {
    if (challenge) await deleteTwoFactorChallenge(c.env.DB, tokenHash);
    return c.json({ success: false, error: '設定の有効時間が切れました。ログインからやり直してください' }, 401);
  }
  if (challenge.attempts >= TWO_FACTOR_MAX_ATTEMPTS) {
    await deleteTwoFactorChallenge(c.env.DB, tokenHash);
    return c.json({ success: false, error: '入力回数を超えました。ログインからやり直してください' }, 429);
  }

  const staff = await getStaffById(c.env.DB, challenge.staff_id);
  const masterKey = c.env.TOTP_ENCRYPTION_KEY;
  if (!staff?.is_active || !staff.totp_pending_secret_enc || !masterKey) {
    return c.json({ success: false, error: '二段階認証を確認できません' }, 401);
  }
  const verified = await verifyTotp(
    await decryptTotpSecret(staff.totp_pending_secret_enc, masterKey),
    code,
    Date.now(),
  );
  if (!verified.valid || verified.step === null) {
    await incrementTwoFactorChallengeAttempts(c.env.DB, tokenHash);
    return c.json({ success: false, error: '認証コードが正しくありません' }, 400);
  }

  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) return c.json({ success: false, error: config.misconfigured }, 500);

  const updated = await updateStaffMember(c.env.DB, staff.id, {
    totp_secret_enc: staff.totp_pending_secret_enc,
    totp_pending_secret_enc: null,
    totp_enabled_at: new Date().toISOString(),
    // 登録に使ったコードをそのまま次のログインへ使い回せないよう刻む。
    totp_last_used_step: verified.step,
  });
  if (!updated) return c.json({ success: false, error: '二段階認証を確認できません' }, 401);
  await activatePlatformAdminIfAwaitingTotp(c.env.DB, staff.id);
  await deleteTwoFactorChallenge(c.env.DB, tokenHash);

  let session: Awaited<ReturnType<typeof issueSession>>;
  try {
    session = await issueSession(c, staff.id, config.sameSite, challenge.remember === 1);
  } catch (error) {
    logAuthFailure('issueSession', error);
    return c.json({ success: false, error: 'ログイン状態を作成できませんでした。ログインからやり直してください' }, 500);
  }
  await recordLoginAuditBestEffort(c, staff.id);
  return c.json({
    success: true,
    data: { sessionToken: config.crossSite ? session.sessionToken : undefined },
    csrfToken: session.csrfToken,
  });
});

/** 高危険操作の直前だけ使える、5分・1回限りの再認証grantを発行する。 */
adminAuth.post('/api/auth/step-up', async (c) => {
  const staffContext = c.get('staff');
  /*
   * 再認証フロー専用の401。管理画面の共通401処理は code の無い
   * 'Unauthorized'（認証middlewareの応答）をセッション喪失として扱うので、
   * この口が画面側の再認証フローで処理される業務401だと分かるよう
   * 機械コードを付ける（#1058）。
   */
  if (!staffContext) return c.json({ success: false, error: 'Unauthorized', code: 'STEP_UP_UNAUTHORIZED' }, 401);
  const body = await c.req.json<{ code?: string; password?: string; purpose?: string }>()
    .catch(() => ({} as { code?: string; password?: string; purpose?: string }));
  if (!isStepUpPurpose(body.purpose)) {
    return c.json({ success: false, error: '確認する操作を指定してください' }, 400);
  }
  const purpose = body.purpose;
  const staff = await getStaffById(c.env.DB, staffContext.id);
  if (!staff?.is_active) {
    return c.json({ success: false, error: 'このアカウントでは再確認を受け付けられません' }, 403);
  }
  /*
   * 確認の手段は本人の設定で決まる（V）：二段階認証を使っている人は6桁の
   * コード、使っていない人はパスワード。手段ごとに「何を聞くか」の文言を
   * 分けるため、どちらの経路かを先に確定する。
   * 形式の検査は試行枠の確保より先に行う。形になっていない入力で
   * 試行回数を消費させないため。
   */
  const useTotp = Boolean(staff.totp_enabled_at && staff.totp_secret_enc && c.env.TOTP_ENCRYPTION_KEY);
  const code = body.code?.trim() ?? '';
  const password = body.password ?? '';
  if (useTotp && !/^\d{6}$/.test(code)) {
    return c.json({ success: false, error: '6桁の認証コードを入力してください' }, 400);
  }
  if (!useTotp && staff.password_hash && !password) {
    return c.json({ success: false, error: 'パスワードを入力してください' }, 400);
  }
  if (!useTotp && !staff.password_hash) {
    return c.json({ success: false, error: '重要操作には二段階認証またはパスワードの設定が必要です' }, 403);
  }
  const attempt = await reserveStepUpAttempt(c.env.DB, staff.id);
  if (!attempt) {
    return stepUpRateLimitResponse(c, staff.id);
  }
  let totpStep: number | undefined;
  if (useTotp) {
    const verified = await verifyTotp(
      await decryptTotpSecret(staff.totp_secret_enc!, c.env.TOTP_ENCRYPTION_KEY!),
      code,
      Date.now(),
      staff.totp_last_used_step,
    );
    if (!verified.valid || verified.step === null) {
      if (attempt.attempts >= attempt.maxAttempts) {
        return stepUpRateLimitResponse(c, staff.id);
      }
      return c.json({ success: false, error: '認証コードが正しくありません' }, 400);
    }
    totpStep = verified.step;
  } else {
    if (!await verifyPassword(password, staff.password_hash!)) {
      if (attempt.attempts >= attempt.maxAttempts) {
        return stepUpRateLimitResponse(c, staff.id);
      }
      return c.json({ success: false, error: 'パスワードが正しくありません' }, 400);
    }
  }
  /*
   * R504: コードの一回限りの確保と確認票発行に成功した要求だけを
   * 本人確認済みにする。並行要求に負けた側（409「使用済み」）の
   * セッションには確認済み時刻を残さない。失敗応答と保存状態を一致させる。
   */
  const sessionTokenHash = await adminSessionTokenHashFromRequest(c);
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  // 確認票は発行したセッションと発行時の権限の版に結び付ける。
  // ログアウト・権限の更新の後は使えない（使う側で再認証を案内する）。
  if (!await createStepUpGrant(c.env.DB, {
    tokenHash: await sha256Hex(token),
    staffId: staff.id,
    purpose,
    expiresAt,
    totpStep,
    sessionTokenHash,
    issuedPolicyVersion: Number(staff.policy_version ?? 1),
  })) {
    return c.json({ success: false, error: 'この認証コードは使用済みです' }, 409);
  }
  /*
   * 再確認済みの時刻をセッションへ刻む。同じセッションは10分の窓で
   * 何度も聞かれない。APIキー経路（セッション行が無い）は何もしない。
   */
  if (sessionTokenHash) {
    await markAdminSessionStepUp(c.env.DB, sessionTokenHash, new Date().toISOString());
  }
  if (totpStep === undefined) await clearStepUpAttempts(c.env.DB, staff.id);
  return c.json({ success: true, data: { token, purpose, expiresAt } }, 201);
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
adminAuth.post('/api/auth/login', async (c) => {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) {
    console.error('[admin-auth] refused login — misconfigured topology:', config.misconfigured);
    return c.json({ success: false, error: config.misconfigured }, 500);
  }

  const body = await c.req
    .json<{ apiKey?: string; remember?: boolean }>()
    .catch(() => ({}) as { apiKey?: string; remember?: boolean });
  const apiKey = body.apiKey?.trim() ?? '';
  const remember = body.remember === true;
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
    const maxAge = remember ? SESSION_REMEMBER_MAX_AGE : SESSION_DEFAULT_MAX_AGE;
    c.header('Set-Cookie', adminSessionCookie(apiKey, config.sameSite, maxAge), { append: true });
    c.header('Set-Cookie', csrfCookie(csrfToken, config.sameSite, maxAge), { append: true });
  } else {
    // 2段階認証は削除済み。APIキー確認後そのままセッションを発行する。
    csrfToken = (await issueSession(c, staff.id, config.sameSite, remember)).csrfToken;
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
  const staff = c.get('staff');
  // 運営マスターかどうか。platform_admins が空の間は既定の統括のオーナーも真になる
  // （初期登録のため。API 側の requirePlatformAdmin と同じ判定）。
  const platformAdmin = await isPlatformAdmin(c);
  // 招待の進み具合（★V6 37-10）。awaiting_totp なら画面は 2要素認証の設定へ案内する。
  const platformAdminRecord = staff.id === 'env-owner' ? null : await getPlatformAdminRecord(c.env.DB, staff.id);
  const platformAdminState = platformAdminRecord?.is_active === 1 ? platformAdminRecord.activation_state : null;
  // /api/auth/* は代理ログインの差し替え対象外なので、ここで直接引く。
  const active = platformAdmin ? await getActiveImpersonation(c.env.DB, staff.id) : null;
  const impersonation = active ? toImpersonationContext(active) : null;
  /*
   * いつもと違う端末・場所からのログインか（V-2 の帯）。セッション行が
   * 無いAPIキー経路では null のまま。取れないときもログイン画面と同じく
   * 表示を止めないため失敗は null に畳む。
   */
  const sessionTokenHash = await adminSessionTokenHashFromRequest(c);
  let currentSession = null;
  if (sessionTokenHash) {
    try {
      currentSession = await getAdminSessionByTokenHash(c.env.DB, sessionTokenHash);
    } catch {
      // セッション行が読めなくても本人確認情報の表示を止めない。
      currentSession = null;
    }
  }
  /*
   * 再確認の聞き方（V-1 ダイアログの表示切替）。2段階認証の設定があれば
   * 認証アプリの6桁、無ければパスワード。どちらも無い人は大事な操作の前に
   * 設定へ誘導するため 'none'。staff文脈にはTOTP・パスワード列が無いので
   * 本体を引き直す。
   */
  const staffRecord = staff.id === 'env-owner' ? null : await getStaffById(c.env.DB, staff.id).catch(() => null);
  const stepUpMethod = staffRecord?.totp_enabled_at && staffRecord.totp_secret_enc
    ? 'totp'
    : staffRecord?.password_hash ? 'password' : 'none';
  return c.json({
    success: true,
    data: {
      ...staff,
      tenantStatus: staff.tenantStatus ?? 'active',
      platformAdmin,
      platformAdminState,
      impersonation,
      unfamiliarAt: currentSession?.unfamiliar_at ?? null,
      stepUpMethod,
    },
    csrfToken,
  });
});

/**
 * 今のリクエストを通したセッションの生token。cookie優先、無ければBearer。
 * 見つからなければ null（API key ログイン等、セッション表へ載らない経路）。
 */
function currentSessionToken(c: Context<Env>): string | null {
  const fromCookie = adminSessionTokenFromCookie(c);
  if (fromCookie) return fromCookie;
  const authorization = c.req.header('Authorization') || '';
  const bearerPrefix = `Bearer ${ADMIN_SESSION_BEARER_PREFIX}`;
  return authorization.startsWith(bearerPrefix) ? authorization.slice(bearerPrefix.length) : null;
}

/** GET /api/auth/sessions — 本人のアクティブなセッションだけを返す。 */
adminAuth.get('/api/auth/sessions', async (c) => {
  const staff = c.get('staff');
  if (!staff) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const currentHash = (token => token ? sha256Hex(token) : Promise.resolve(null))(currentSessionToken(c));
  const rows = await listAdminSessionsByStaff(c.env.DB, staff.id, new Date().toISOString());
  const sessions = rows.map((row) => ({
    id: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    userAgent: row.user_agent,
    ipPrefix: row.ip_prefix,
    current: false as boolean,
  }));
  const hash = await currentHash;
  for (const session of sessions) session.current = session.id === hash;
  return c.json({ success: true, data: { sessions } });
});

/**
 * DELETE /api/auth/sessions/:tokenHash — 本人のセッションを1件失効する。
 *
 * 他人の token_hash を指定しても 404（存在も明かさない）。今のセッションを
 * 消すときは `?confirmCurrent=1` か body の `confirmCurrent: true` が必須で、
 * 確認付きなら cookie も期限切れにして再利用を防ぐ。
 */
adminAuth.delete('/api/auth/sessions/:tokenHash', async (c) => {
  const staff = c.get('staff');
  if (!staff) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const tokenHash = c.req.param('tokenHash');
  const currentToken = currentSessionToken(c);
  const currentHash = currentToken ? await sha256Hex(currentToken) : null;
  const body = await c.req.json<{ confirmCurrent?: boolean }>().catch(() => ({} as { confirmCurrent?: boolean }));
  const confirmed = body.confirmCurrent === true || c.req.query('confirmCurrent') === '1';
  if (currentHash === tokenHash && !confirmed) {
    return c.json({
      success: false,
      error: '今使っている端末のログインを切るには confirmCurrent=1 を付けてください',
      code: 'CURRENT_SESSION_CONFIRMATION_REQUIRED',
    }, 409);
  }
  if (!await deleteAdminSessionForStaff(c.env.DB, staff.id, tokenHash)) {
    return c.json({ success: false, error: 'Session not found' }, 404);
  }
  if (currentHash === tokenHash) {
    const { sameSite } = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
    c.header('Set-Cookie', expiredCookie(ADMIN_AUTH_COOKIE, sameSite), { append: true });
    c.header('Set-Cookie', expiredCookie(CSRF_COOKIE, sameSite), { append: true });
  }
  return c.json({ success: true, data: { revoked: 1, current: currentHash === tokenHash } });
});

/** POST /api/auth/sessions/revoke-others — 今のセッション以外をまとめて失効する。 */
adminAuth.post('/api/auth/sessions/revoke-others', async (c) => {
  const staff = c.get('staff');
  if (!staff) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const currentToken = currentSessionToken(c);
  const currentHash = currentToken ? await sha256Hex(currentToken) : null;
  const revoked = currentHash
    ? await deleteOtherAdminSessions(c.env.DB, staff.id, currentHash)
    : 0;
  // 一括失効は乗っ取り対応で使われる高危険操作。記録失敗で失効自体は止めない。
  try {
    await recordAuditEvent(c.env.DB, {
      category: 'auth',
      action: 'auth.sessions_revoked',
      actorPrincipalId: staff.id,
      actorRole: staff.readOnly ? 'view_only' : staff.role === 'owner' || staff.role === 'admin' ? 'administrator' : 'operations',
      targetKind: 'staff',
      targetId: staff.id,
      tenantId: staff.tenantId,
      result: 'success',
      riskLevel: 'high',
      retentionClass: 'security',
      reason: 'revoke_other_sessions',
      ipPrefix: maskIpPrefix(clientIp(c)),
      after: { revoked },
    });
  } catch (error) {
    console.error('[admin-auth] sessions_revoked audit failed', error instanceof Error ? error.name : 'unknown');
  }
  return c.json({ success: true, data: { revoked } });
});
