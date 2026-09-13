import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../index.js';
import { sha256Hex } from '../middleware/auth.js';
import { resolveAdminAuthConfig } from '../middleware/admin-auth-config.js';
import {
  bumpAuthThrottle,
  clearAuthThrottle,
  consumeAuthEmailToken,
  createAuthEmailToken,
  createStaffMember,
  createTrialTenant,
  getActiveStaffByEmail,
  getAuthEmailToken,
  getStaffById,
  getStaffWithPasswordByEmail,
  hasStaffWithEmail,
  hasTenantWithDeviceMarker,
  readAuthThrottle,
  recordLoginAudit,
  revokeStaffAuthentication,
  toJstString,
  updateStaffMember,
  type AuthEmailToken,
} from '@line-crm/db';
import { clientIp, issueSession, randomToken, startTwoFactorChallenge, twoFactorRequired } from '../services/admin-session.js';
import { hashPassword, validatePasswordPolicy, verifyPassword } from '../services/password-hash.js';
import { turnstileErrorMessage, verifyTurnstile } from '../services/turnstile.js';
import {
  PASSWORD_RESET_TOKEN_TTL_MS,
  SIGNUP_TOKEN_TTL_MS,
  sendAlreadyRegisteredMail,
  sendPasswordResetMail,
  sendSignupVerifyMail,
} from '../services/auth-mail.js';
import { TRIAL_DAYS } from '../services/billing-plans.js';

/**
 * 会員登録（★V6 36-4）・メール＋パスワードのログイン・パスワード再設定（36-6）。
 *
 * 流れ（決定 2026-09-13）:
 *   1. メールアドレスだけ入れる → 本登録 URL をメールで送る（誤入力のメールでは進まない）
 *   2. URL の先で会社名・名前・パスワードを入れる → 統括（トライアル 30 日）とオーナー権限者ができ、そのままログイン
 *
 * 守り:
 *   - Turnstile（ロボット対策）。秘密の鍵が無いときは受け付けない
 *   - 同じブラウザからの 2 回目の登録は断る（印を localStorage と Cookie の両方に置く）
 *   - 同じ接続元・同じメールからの送信回数を D1 に残して数える（再起動で消えない）
 *   - メールが登録済みかどうかは返事で分からないようにする（本人にはメールで知らせる）
 *   - URL の元はハッシュだけ保存し、1 回使ったら消費済みにする
 */
export const authEmail = new Hono<Env>();

const EMAIL_MAX = 254;
const NAME_MAX = 80;
const DEVICE_MARKER_COOKIE = 'lh_signup_marker';
const DEVICE_MARKER_MAX_AGE = 365 * 24 * 60 * 60;

/** 登録依頼: 同じ接続元は 1 日 5 件、同じメールは 1 日 3 件。 */
const SIGNUP_IP_DAILY_MAX = 5;
const SIGNUP_EMAIL_DAILY_MAX = 3;
/** 再設定依頼: 同じ接続元は 1 日 10 件、同じメールは 1 日 3 件。 */
const RESET_IP_DAILY_MAX = 10;
const RESET_EMAIL_DAILY_MAX = 3;
/** パスワードの失敗: メール＋接続元ごとに 15 分で 10 回。 */
const LOGIN_FAIL_MAX = 10;
const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ALREADY_REGISTERED_ON_DEVICE = 'このブラウザではすでに別のメールアドレスで登録されています。ログインするか、お問い合わせください';
const LOGIN_FAILED = 'メールアドレスかパスワードが違います';
const TOO_MANY = '送信回数の上限に達しました。しばらく待ってからもう一度お試しください';

type Body = Record<string, unknown>;

async function readBody(c: Context<Env>): Promise<Body> {
  return c.req.json<Body>().catch(() => ({}) as Body);
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max + 1) : '';
}

/** メールの形。厳密な RFC ではなく「@ の両側に何かあり、空白が無い」程度。送れなければ届かないだけ。 */
export function normalizeEmail(value: unknown): string | null {
  const email = typeof value === 'string' ? value.trim() : '';
  if (!email || email.length > EMAIL_MAX) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email.toLowerCase();
}

function adminBase(c: Context<Env>): string | null {
  const base = c.env.ADMIN_PUBLIC_URL?.replace(/\/+$/, '');
  return base || null;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(value.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function markerCookie(value: string, sameSite: 'Strict' | 'Lax' | 'None'): string {
  return `${DEVICE_MARKER_COOKIE}=${encodeURIComponent(value)}; Path=/api/auth; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${DEVICE_MARKER_MAX_AGE}`;
}

function deviceMarkerOf(c: Context<Env>, body: Body): string[] {
  const markers = new Set<string>();
  const fromBody = text(body.deviceMarker, 128);
  if (/^[A-Za-z0-9_-]{16,128}$/.test(fromBody)) markers.add(fromBody);
  const fromCookie = readCookie(c.req.header('cookie'), DEVICE_MARKER_COOKIE) ?? '';
  if (/^[A-Za-z0-9_-]{16,128}$/.test(fromCookie)) markers.add(fromCookie);
  return [...markers];
}

async function ipHashOf(c: Context<Env>): Promise<string> {
  return sha256Hex(clientIp(c) ?? 'unknown');
}

function tokenState(token: AuthEmailToken | null): 'valid' | 'invalid' | 'expired' | 'used' {
  if (!token) return 'invalid';
  if (token.consumed_at) return 'used';
  if (Date.parse(token.expires_at) <= Date.now()) return 'expired';
  return 'valid';
}

const TOKEN_STATE_MESSAGE: Record<Exclude<ReturnType<typeof tokenState>, 'valid'>, string> = {
  invalid: 'この URL は正しくありません。メールの URL をそのまま開いてください',
  expired: 'この URL の有効期限が切れています。もう一度メールアドレスを入力してください',
  used: 'この URL はすでに使われています。ログインしてください',
};

function readToken(c: Context<Env>, body?: Body): string {
  const raw = body ? text(body.token, 256) : (c.req.query('token') ?? '').trim();
  return /^[A-Za-z0-9_-]{20,256}$/.test(raw) ? raw : '';
}

// ---------------------------------------------------------------------------
// 会員登録
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/register/request
 * { email, turnstileToken, agreed: true, deviceMarker? }
 *
 * 返事はいつも同じ「送りました」。登録済みのメールには本人向けの案内メールを送る。
 */
authEmail.post('/api/auth/register/request', async (c) => {
  const base = adminBase(c);
  if (!base) return c.json({ success: false, error: '管理画面の URL が設定されていません' }, 500);

  const body = await readBody(c);
  const email = normalizeEmail(body.email);
  if (!email) return c.json({ success: false, error: 'メールアドレスの形式が正しくありません' }, 400);
  if (body.agreed !== true) return c.json({ success: false, error: '利用規約とプライバシーポリシーに同意してください' }, 400);

  const turnstile = await verifyTurnstile(c.env, body.turnstileToken as string | undefined, clientIp(c));
  if (!turnstile.ok) {
    return c.json({ success: false, error: turnstileErrorMessage(turnstile.reason) }, turnstile.reason === 'not_configured' ? 503 : 400);
  }

  const markers = deviceMarkerOf(c, body);
  for (const marker of markers) {
    if (await hasTenantWithDeviceMarker(c.env.DB, marker)) {
      return c.json({ success: false, error: ALREADY_REGISTERED_ON_DEVICE, code: 'device_registered' }, 409);
    }
  }

  const ipHash = await ipHashOf(c);
  const emailHash = await sha256Hex(email);
  if ((await bumpAuthThrottle(c.env.DB, `signup:ip:${ipHash}`, DAY_MS)) > SIGNUP_IP_DAILY_MAX) {
    return c.json({ success: false, error: TOO_MANY }, 429);
  }
  if ((await bumpAuthThrottle(c.env.DB, `signup:mail:${emailHash}`, DAY_MS)) > SIGNUP_EMAIL_DAILY_MAX) {
    return c.json({ success: false, error: TOO_MANY }, 429);
  }

  try {
    if (await hasStaffWithEmail(c.env.DB, email)) {
      await sendAlreadyRegisteredMail(c.env, { email, loginUrl: `${base}/login`, forgotUrl: `${base}/password/forgot` });
      return c.json({ success: true, data: { sent: true } });
    }
    const token = randomToken();
    await createAuthEmailToken(c.env.DB, {
      purpose: 'signup',
      tokenHash: await sha256Hex(token),
      email,
      ipHash,
      deviceMarker: markers[0] ?? null,
      expiresAt: toJstString(new Date(Date.now() + SIGNUP_TOKEN_TTL_MS)),
    });
    await sendSignupVerifyMail(c.env, { email, completeUrl: `${base}/register/complete?token=${encodeURIComponent(token)}` });
    return c.json({ success: true, data: { sent: true } });
  } catch (error) {
    console.error('[auth-email] register request failed', error);
    return c.json({ success: false, error: 'メールを送れませんでした。しばらく待ってからもう一度お試しください' }, 502);
  }
});

/** GET /api/auth/register/check?token= — 本登録画面を開いたときに、URL がまだ使えるかとメールを返す。 */
authEmail.get('/api/auth/register/check', async (c) => {
  const token = readToken(c);
  const row = token ? await getAuthEmailToken(c.env.DB, 'signup', await sha256Hex(token)) : null;
  const state = tokenState(row);
  if (state !== 'valid') return c.json({ success: false, error: TOKEN_STATE_MESSAGE[state], code: state }, state === 'invalid' ? 404 : 410);
  return c.json({ success: true, data: { email: row!.email, trialDays: TRIAL_DAYS } });
});

/**
 * POST /api/auth/register/complete
 * { token, tenantName, name, password, deviceMarker? }
 *
 * 統括（トライアル）とオーナー権限者を作り、そのままログインした状態にする。
 */
authEmail.post('/api/auth/register/complete', async (c) => {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) return c.json({ success: false, error: config.misconfigured }, 500);

  const body = await readBody(c);
  const token = readToken(c, body);
  const row = token ? await getAuthEmailToken(c.env.DB, 'signup', await sha256Hex(token)) : null;
  const state = tokenState(row);
  if (state !== 'valid') return c.json({ success: false, error: TOKEN_STATE_MESSAGE[state], code: state }, state === 'invalid' ? 404 : 410);

  const tenantName = text(body.tenantName, NAME_MAX);
  const name = text(body.name, NAME_MAX);
  const password = typeof body.password === 'string' ? body.password : '';
  const errors: Record<string, string> = {};
  if (!tenantName) errors.tenantName = '会社名・統括名を入力してください';
  else if (tenantName.length > NAME_MAX) errors.tenantName = `会社名・統括名は${NAME_MAX}文字以内で入力してください`;
  if (!name) errors.name = 'お名前を入力してください';
  else if (name.length > NAME_MAX) errors.name = `お名前は${NAME_MAX}文字以内で入力してください`;
  const passwordError = validatePasswordPolicy(password);
  if (passwordError) errors.password = passwordError;
  if (Object.keys(errors).length) return c.json({ success: false, error: Object.values(errors)[0], errors }, 400);

  const markers = deviceMarkerOf(c, body);
  for (const marker of markers) {
    if (await hasTenantWithDeviceMarker(c.env.DB, marker)) {
      return c.json({ success: false, error: ALREADY_REGISTERED_ON_DEVICE, code: 'device_registered' }, 409);
    }
  }
  if (await hasStaffWithEmail(c.env.DB, row!.email)) {
    return c.json({ success: false, error: 'このメールアドレスはすでに登録されています。ログインしてください', code: 'email_registered' }, 409);
  }

  // 二重送信で 2 つ作らないよう、先に URL を消費する。
  if (!(await consumeAuthEmailToken(c.env.DB, row!.id))) {
    return c.json({ success: false, error: TOKEN_STATE_MESSAGE.used, code: 'used' }, 410);
  }

  const deviceMarker = markers[0] ?? randomToken(24);
  const now = new Date();
  const tenantId = await createTrialTenant(c.env.DB, {
    name: tenantName,
    trialEndsAt: toJstString(new Date(now.getTime() + TRIAL_DAYS * DAY_MS)),
    deviceMarker,
  });
  const created = await createStaffMember(c.env.DB, {
    name,
    email: row!.email,
    role: 'owner',
    is_active: 1,
    invite_status: 'active',
    tenant_id: tenantId,
  });
  const staff = await updateStaffMember(c.env.DB, created.id, {
    password_hash: await hashPassword(password),
    password_updated_at: toJstString(now),
    email_verified_at: toJstString(now),
  });
  if (!staff) return c.json({ success: false, error: '登録を完了できませんでした' }, 500);

  const session = await issueSession(c, staff.id, config.sameSite);
  c.header('Set-Cookie', markerCookie(deviceMarker, config.sameSite), { append: true });
  await recordLoginAudit(c.env.DB, {
    adminUserId: staff.id,
    action: 'login',
    ip: clientIp(c),
    userAgent: c.req.header('user-agent') ?? null,
  });
  return c.json({
    success: true,
    data: {
      tenantId,
      deviceMarker,
      // 別サイト構成のときだけ SPA にセッションを渡す（two-factor/verify と同じ）。
      sessionToken: config.crossSite ? session.sessionToken : undefined,
    },
    csrfToken: session.csrfToken,
  });
});

// ---------------------------------------------------------------------------
// メール＋パスワードのログイン
// ---------------------------------------------------------------------------

/** POST /api/auth/password/login { email, password } */
authEmail.post('/api/auth/password/login', async (c) => {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) return c.json({ success: false, error: config.misconfigured }, 500);

  const body = await readBody(c);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return c.json({ success: false, error: 'メールアドレスとパスワードを入力してください' }, 400);

  const throttleKey = `login:${await sha256Hex(`${email}|${clientIp(c) ?? 'unknown'}`)}`;
  if ((await readAuthThrottle(c.env.DB, throttleKey, LOGIN_FAIL_WINDOW_MS)) >= LOGIN_FAIL_MAX) {
    return c.json({ success: false, error: '失敗が続いたため、15分ほど待ってからもう一度お試しください' }, 429);
  }

  const staff = await getStaffWithPasswordByEmail(c.env.DB, email);
  const ok = staff ? await verifyPassword(password, staff.password_hash) : await verifyPassword(password, null);
  if (!staff || !ok || !staff.is_active) {
    await bumpAuthThrottle(c.env.DB, throttleKey, LOGIN_FAIL_WINDOW_MS);
    await recordLoginAudit(c.env.DB, {
      adminUserId: staff?.id ?? null,
      action: 'fail',
      ip: clientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
      result: 'unauthorized',
    });
    return c.json({ success: false, error: LOGIN_FAILED }, 401);
  }

  await clearAuthThrottle(c.env.DB, throttleKey);
  if (twoFactorRequired(staff)) {
    if (!c.env.TOTP_ENCRYPTION_KEY) return c.json({ success: false, error: '二段階認証の設定に不備があります。運営にお問い合わせください' }, 500);
    const challengeToken = await startTwoFactorChallenge(c, staff.id);
    return c.json({ success: true, data: { twoFactor: true, challengeToken } });
  }

  const session = await issueSession(c, staff.id, config.sameSite);
  await recordLoginAudit(c.env.DB, {
    adminUserId: staff.id,
    action: 'login',
    ip: clientIp(c),
    userAgent: c.req.header('user-agent') ?? null,
  });
  return c.json({
    success: true,
    data: { twoFactor: false, sessionToken: config.crossSite ? session.sessionToken : undefined },
    csrfToken: session.csrfToken,
  });
});

// ---------------------------------------------------------------------------
// パスワード再設定
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/password/forgot { email, turnstileToken }
 *
 * 返事はいつも同じ。パスワードを持つ権限者がいればその人へ、いなければ
 * そのメールの有効な権限者がちょうど 1 人のときだけ送る（LINE だけの人が
 * あとからパスワードを持てる道）。
 */
authEmail.post('/api/auth/password/forgot', async (c) => {
  const base = adminBase(c);
  if (!base) return c.json({ success: false, error: '管理画面の URL が設定されていません' }, 500);

  const body = await readBody(c);
  const email = normalizeEmail(body.email);
  if (!email) return c.json({ success: false, error: 'メールアドレスの形式が正しくありません' }, 400);

  const turnstile = await verifyTurnstile(c.env, body.turnstileToken as string | undefined, clientIp(c));
  if (!turnstile.ok) {
    return c.json({ success: false, error: turnstileErrorMessage(turnstile.reason) }, turnstile.reason === 'not_configured' ? 503 : 400);
  }

  const ipHash = await ipHashOf(c);
  const emailHash = await sha256Hex(email);
  if ((await bumpAuthThrottle(c.env.DB, `reset:ip:${ipHash}`, DAY_MS)) > RESET_IP_DAILY_MAX) {
    return c.json({ success: false, error: TOO_MANY }, 429);
  }
  if ((await bumpAuthThrottle(c.env.DB, `reset:mail:${emailHash}`, DAY_MS)) > RESET_EMAIL_DAILY_MAX) {
    return c.json({ success: false, error: TOO_MANY }, 429);
  }

  try {
    const withPassword = await getStaffWithPasswordByEmail(c.env.DB, email);
    const candidates = withPassword ? [withPassword] : await getActiveStaffByEmail(c.env.DB, email);
    const target = candidates.length === 1 && candidates[0].is_active ? candidates[0] : null;
    if (target) {
      const token = randomToken();
      await createAuthEmailToken(c.env.DB, {
        purpose: 'password_reset',
        tokenHash: await sha256Hex(token),
        email,
        staffId: target.id,
        ipHash,
        expiresAt: toJstString(new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS)),
      });
      await sendPasswordResetMail(c.env, {
        email,
        name: target.name,
        resetUrl: `${base}/password/reset?token=${encodeURIComponent(token)}`,
      });
    }
    return c.json({ success: true, data: { sent: true } });
  } catch (error) {
    console.error('[auth-email] password forgot failed', error);
    return c.json({ success: false, error: 'メールを送れませんでした。しばらく待ってからもう一度お試しください' }, 502);
  }
});

/** GET /api/auth/password/reset/check?token= */
authEmail.get('/api/auth/password/reset/check', async (c) => {
  const token = readToken(c);
  const row = token ? await getAuthEmailToken(c.env.DB, 'password_reset', await sha256Hex(token)) : null;
  const state = tokenState(row);
  if (state !== 'valid') return c.json({ success: false, error: TOKEN_STATE_MESSAGE[state], code: state }, state === 'invalid' ? 404 : 410);
  return c.json({ success: true, data: { email: row!.email } });
});

/** POST /api/auth/password/reset { token, password } — 設定後はその人のセッションをすべて失効させる。 */
authEmail.post('/api/auth/password/reset', async (c) => {
  const body = await readBody(c);
  const token = readToken(c, body);
  const row = token ? await getAuthEmailToken(c.env.DB, 'password_reset', await sha256Hex(token)) : null;
  const state = tokenState(row);
  if (state !== 'valid') return c.json({ success: false, error: TOKEN_STATE_MESSAGE[state], code: state }, state === 'invalid' ? 404 : 410);

  const password = typeof body.password === 'string' ? body.password : '';
  const passwordError = validatePasswordPolicy(password);
  if (passwordError) return c.json({ success: false, error: passwordError, errors: { password: passwordError } }, 400);

  const staff = row!.staff_id ? await getStaffById(c.env.DB, row!.staff_id) : null;
  if (!staff || !staff.is_active) return c.json({ success: false, error: TOKEN_STATE_MESSAGE.invalid, code: 'invalid' }, 404);

  // 同じメールでパスワードを持つ別の人がいると一意制約に当たる。先に確かめて分かる言葉で断る。
  const holder = await getStaffWithPasswordByEmail(c.env.DB, row!.email);
  if (holder && holder.id !== staff.id) {
    return c.json({ success: false, error: 'このメールアドレスは別の権限者がパスワードで使っています。運営にお問い合わせください' }, 409);
  }

  if (!(await consumeAuthEmailToken(c.env.DB, row!.id))) {
    return c.json({ success: false, error: TOKEN_STATE_MESSAGE.used, code: 'used' }, 410);
  }
  const now = toJstString(new Date());
  await updateStaffMember(c.env.DB, staff.id, {
    password_hash: await hashPassword(password),
    password_updated_at: now,
    email_verified_at: staff.email_verified_at ?? now,
  });
  await revokeStaffAuthentication(c.env.DB, staff.id);
  return c.json({ success: true, data: { email: row!.email } });
});
