import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../index.js';
import {
  ADMIN_AUTH_COOKIE,
  CSRF_COOKIE,
  adminSessionCookie,
  adminSessionTokenFromCookie,
  authenticateApiToken,
  csrfCookie,
  csrfTokenFromCookie,
  expiredCookie,
  SESSION_MAX_AGE,
  sha256Hex,
} from '../middleware/auth.js';
import { resolveAdminAuthConfig } from '../middleware/admin-auth-config.js';
import {
  createAdminSession,
  deleteAdminSession,
  getStaffByLineUserId,
} from '@line-crm/db';

export const adminAuth = new Hono<Env>();

const OAUTH_STATE_COOKIE = 'lh_line_state';
const OAUTH_NONCE_COOKIE = 'lh_line_nonce';
const OAUTH_VERIFIER_COOKIE = 'lh_line_verifier';
const OAUTH_MAX_AGE = 600;

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

async function issueSession(c: Context<Env>, staffId: string, sameSite: 'Strict' | 'Lax' | 'None') {
  const sessionToken = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  await createAdminSession(c.env.DB, await sha256Hex(sessionToken), staffId, expiresAt);
  const csrfToken = randomToken();
  c.header('Set-Cookie', adminSessionCookie(sessionToken, sameSite), { append: true });
  c.header('Set-Cookie', csrfCookie(csrfToken, sameSite), { append: true });
  return csrfToken;
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
  const state = c.req.query('state');
  const code = c.req.query('code');

  for (const name of [OAUTH_STATE_COOKIE, OAUTH_NONCE_COOKIE, OAUTH_VERIFIER_COOKIE]) {
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

    const staff = await getStaffByLineUserId(c.env.DB, profile.sub);
    if (!staff) return c.redirect(adminLoginUrl(c, 'not_authorized'));

    const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
    if (config.misconfigured) return c.redirect(adminLoginUrl(c, 'configuration_error'));
    await issueSession(c, staff.id, config.sameSite);
    return c.redirect(c.env.ADMIN_PUBLIC_URL!.replace(/\/+$/, ''));
  } catch (error) {
    console.error('[admin-auth] LINE Login callback failed', error);
    return c.redirect(adminLoginUrl(c, 'line_login_failed'));
  }
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
    .json<{ apiKey?: string }>()
    .catch(() => ({}) as { apiKey?: string });
  const apiKey = body.apiKey?.trim() ?? '';
  const staff = await authenticateApiToken(c, apiKey || null);

  if (!staff) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  let csrfToken: string;
  if (staff.id === 'env-owner') {
    // Emergency recovery only. The normal UI never asks for or exposes this key.
    csrfToken = crypto.randomUUID();
    c.header('Set-Cookie', adminSessionCookie(apiKey, config.sameSite), { append: true });
    c.header('Set-Cookie', csrfCookie(csrfToken, config.sameSite), { append: true });
  } else {
    csrfToken = await issueSession(c, staff.id, config.sameSite);
  }
  return c.json({ success: true, data: staff, csrfToken });
});

/**
 * POST /api/auth/logout — clears both cookies. No CSRF required: clearing your
 * own session is not a meaningful CSRF target, and this keeps logout resilient
 * even if the CSRF token was lost client-side.
 */
adminAuth.post('/api/auth/logout', async (c) => {
  const token = adminSessionTokenFromCookie(c);
  if (token) await deleteAdminSession(c.env.DB, await sha256Hex(token));
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
