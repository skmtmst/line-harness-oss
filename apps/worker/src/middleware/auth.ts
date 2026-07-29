import type { Context, Next } from 'hono';
import { getStaffByApiKey, getStaffById } from '@line-crm/db';
import type { Env } from '../index.js';
import type { AdminSameSite } from './admin-auth-config.js';

export const ADMIN_AUTH_COOKIE = 'lh_admin_session';
export const CSRF_COOKIE = 'lh_csrf';
export const CSRF_HEADER = 'x-csrf-token';

// 7 days, matching the previous localStorage session longevity.
const SESSION_MAX_AGE = 604800;
// Home Screen web apps on iOS may discard cross-site cookies between launches.
// The signed bearer is therefore long-lived and refreshed whenever the app
// restores its session. Staff status is still checked against D1 on every
// request, so disabling a staff member revokes access immediately.
const ACCESS_TOKEN_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const ACCESS_TOKEN_PREFIX = 'lhs_';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * decodeURIComponent throws on malformed percent escapes (e.g. `%`). Cookie
 * headers are client-controlled, so fall back to the raw value rather than
 * letting the exception turn a request into a 500.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) continue;
    cookies[rawName] = safeDecode(rawValue.join('=') || '');
  }
  return cookies;
}

function bearerToken(c: Context<Env>): string | null {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length);
}

function cookieToken(c: Context<Env>): string | null {
  return parseCookieHeader(c.req.header('Cookie'))[ADMIN_AUTH_COOKIE] || null;
}

export function csrfTokenFromCookie(c: Context<Env>): string | null {
  return parseCookieHeader(c.req.header('Cookie'))[CSRF_COOKIE] || null;
}

function buildCookie(
  name: string,
  value: string,
  sameSite: AdminSameSite,
  maxAge: number,
  httpOnly: boolean,
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
  if (httpOnly) parts.push('HttpOnly');
  parts.push('Secure', `SameSite=${sameSite}`, `Max-Age=${maxAge}`);
  return parts.join('; ');
}

/** HttpOnly session cookie carrying the API token. */
export function adminSessionCookie(token: string, sameSite: AdminSameSite): string {
  return buildCookie(ADMIN_AUTH_COOKIE, token, sameSite, SESSION_MAX_AGE, true);
}

/**
 * CSRF cookie. NOT HttpOnly so it can participate in double-submit, but in a
 * cross-site topology the SPA cannot read it (different registrable domain) —
 * the token is therefore also returned in the login/session response body and
 * the SPA echoes it via the X-CSRF-Token header. The Worker validates that
 * header against this cookie, which the browser does send back to the API
 * (SameSite=None).
 */
export function csrfCookie(token: string, sameSite: AdminSameSite): string {
  return buildCookie(CSRF_COOKIE, token, sameSite, SESSION_MAX_AGE, false);
}

export function expiredCookie(name: string, sameSite: AdminSameSite): string {
  return buildCookie(name, '', sameSite, 0, name === ADMIN_AUTH_COOKIE);
}

export type AuthenticatedStaff = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'staff';
};

type AdminAccessTokenPayload = {
  sub: string;
  exp: number;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function adminAccessTokenKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Short-lived bearer fallback for browsers that block third-party cookies
 * (notably mobile Safari with Pages ↔ workers.dev). Only this derived token,
 * never the long-lived API key, is stored by the admin SPA.
 */
export async function createAdminAccessToken(
  staff: AuthenticatedStaff,
  secret: string,
  now = Date.now(),
): Promise<string> {
  const payload: AdminAccessTokenPayload = {
    sub: staff.id,
    exp: Math.floor(now / 1000) + ACCESS_TOKEN_MAX_AGE_SECONDS,
  };
  const encodedPayload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    await adminAccessTokenKey(secret),
    new TextEncoder().encode(encodedPayload),
  );
  return `${ACCESS_TOKEN_PREFIX}${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function authenticateAdminAccessToken(
  c: Context<Env>,
  token: string,
): Promise<AuthenticatedStaff | null> {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  const [encodedPayload, encodedSignature, ...extra] = token
    .slice(ACCESS_TOKEN_PREFIX.length)
    .split('.');
  if (!encodedPayload || !encodedSignature || extra.length > 0) return null;

  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await adminAccessTokenKey(c.env.ADMIN_SESSION_SECRET ?? c.env.API_KEY),
      base64UrlToBytes(encodedSignature),
      new TextEncoder().encode(encodedPayload),
    );
    if (!valid) return null;
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(encodedPayload)),
    ) as AdminAccessTokenPayload;
    if (!payload.sub || !Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (payload.sub === 'env-owner') {
      return { id: 'env-owner', name: 'Owner', role: 'owner' };
    }
    const member = await getStaffById(c.env.DB, payload.sub);
    if (!member || member.is_active !== 1) return null;
    return { id: member.id, name: member.name, role: member.role };
  } catch {
    return null;
  }
}

/**
 * Resolve a token (from a Bearer header or the session cookie) to a staff
 * identity. Shared by the auth middleware and the /api/auth/login endpoint so
 * cookie and Bearer auth accept exactly the same credentials.
 */
export async function authenticateApiToken(
  c: Context<Env>,
  token: string | null,
): Promise<AuthenticatedStaff | null> {
  if (!token) return null;

  const accessTokenStaff = await authenticateAdminAccessToken(c, token);
  if (accessTokenStaff) return accessTokenStaff;

  const staff = await getStaffByApiKey(c.env.DB, token);
  if (staff) {
    return { id: staff.id, name: staff.name, role: staff.role };
  }

  // Fallback: env API_KEY acts as owner (current rotation slot)
  if (token === c.env.API_KEY) {
    return { id: 'env-owner', name: 'Owner', role: 'owner' };
  }

  // Legacy fallback: LEGACY_API_KEY accepted during rotation grace period.
  // Same-value guard: if both env vars are set to the same secret, the primary
  // check above already accepts it; this branch must skip to avoid false
  // LEGACY counters. Logs accept_via=LEGACY_API_KEY so operators can confirm
  // zero legacy usage before deleting the secret.
  if (
    c.env.LEGACY_API_KEY &&
    c.env.LEGACY_API_KEY !== c.env.API_KEY &&
    token === c.env.LEGACY_API_KEY
  ) {
    console.log('[auth] accept_via=LEGACY_API_KEY');
    return { id: 'env-owner', name: 'Owner', role: 'owner' };
  }

  return null;
}

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Skip auth for the LINE webhook endpoint — it uses signature verification instead
  // Skip auth for OpenAPI docs — public documentation
  const path = new URL(c.req.url).pathname;
  // LIFF / admin の SPA アセットは Authorization ヘッダなしで HTML を取りに
  // くる。Worker は API 以外のパスを ASSETS バインディングから配信するので、
  // /api/ で始まらないパスは認証 skip して static asset として返す。
  // (admin は別ホスト、Worker の non-API path はすべて LIFF/SPA 経由)
  if (!path.startsWith('/api/')) {
    // ただし内部用エンドポイント (/webhook, /auth, /setup) は元の skip 判定に任せる
    if (
      path !== '/webhook' &&
      !path.startsWith('/auth/') &&
      path !== '/setup' &&
      !path.startsWith('/t/') &&
      !path.startsWith('/r/') &&
      !path.startsWith('/pool/') &&
      !path.startsWith('/images/')
    ) {
      return next();
    }
  }
  if (
    path === '/webhook' ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/pool/') ||
    path.startsWith('/images/') ||
    // 画像 src として <img> 経由でブラウザが取得するため (Authorization ヘッダ不可)。
    // R2 key 内に group_id / page_id (UUID) が含まれるので推測困難。draft 画像も
    // 最終的に LINE 上で公開されるため機密性は低い。
    path.startsWith('/api/rich-menu-images/') ||
    // LINE 上 rich menu 画像 proxy (Authorization ヘッダなしで <img src> 経由表示)
    path.match(/^\/api\/rich-menu-groups\/external\/[^/]+\/image$/) ||
    path.startsWith('/api/liff/') ||
    // Admin login/logout — issue/clear the session cookie before auth exists.
    path === '/api/auth/login' ||
    path === '/api/auth/logout' ||
    path.startsWith('/auth/') ||
    path === '/setup' ||
    path === '/api/integrations/stripe/webhook' ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    path.match(/^\/api\/forms\/[^/]+\/submit$/) ||
    path.match(/^\/api\/forms\/[^/]+\/opened$/) ||
    path.match(/^\/api\/forms\/[^/]+\/partial$/) ||
    path.match(/^\/api\/forms\/[^/]+$/) || // GET form definition (public for LIFF)
    path === '/api/meet-callback' || // Meet Harness completion callback
    path === '/api/qr' || // Public QR proxy — used by desktop landing pages
    path === '/api/health' // Liveness probe (update CLI / self-update verify)
  ) {
    return next();
  }

  const bearer = bearerToken(c);
  const cookie = cookieToken(c);
  const token = bearer ?? cookie;

  const staff = await authenticateApiToken(c, token);
  if (!staff) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  // CSRF protection applies ONLY to cookie-authenticated, state-changing
  // requests. Bearer callers (SDK/MCP) cannot be driven cross-site by a
  // browser (an attacker cannot set the Authorization header), so they are
  // exempt. Safe methods (GET/HEAD/OPTIONS) never mutate, so they are exempt.
  if (!bearer && cookie && !SAFE_METHODS.has(c.req.method.toUpperCase())) {
    const header = c.req.header(CSRF_HEADER);
    const expected = csrfTokenFromCookie(c);
    if (!header || !expected || header !== expected) {
      return c.json({ success: false, error: 'CSRF token mismatch' }, 403);
    }
  }

  c.set('staff', staff);
  return next();
}
