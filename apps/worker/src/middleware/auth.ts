import type { Context, Next } from 'hono';
import { getStaffByAdminSession, getStaffByApiKey } from '@line-crm/db';
import type { Env } from '../index.js';
import type { AdminSameSite } from './admin-auth-config.js';

export const ADMIN_AUTH_COOKIE = 'lh_admin_session';
export const ADMIN_SESSION_BEARER_PREFIX = 'lh_session:';
export const CSRF_COOKIE = 'lh_csrf';
export const CSRF_HEADER = 'x-csrf-token';

// 7 days, matching the previous localStorage session longevity.
export const SESSION_MAX_AGE = 604800;

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

export function adminSessionTokenFromCookie(c: Context<Env>): string | null {
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

export type StaffRole = 'owner' | 'admin' | 'staff';

/**
 * 認証済みの利用者。
 *
 * 役割と読み取り専用は別々に持つ。以前は access_level='read_only' の人を
 * 役割にかかわらず 'viewer' へ潰していたため、「閲覧のみのオーナー」と
 * 「閲覧のみのスタッフ」を区別できず、機密情報の閲覧をサーバー側で
 * 制御できなかった。
 *
 * 更新の可否は readOnly、閲覧の可否は role で判定する。
 */
export type AuthenticatedStaff = {
  id: string;
  name: string;
  role: StaffRole;
  /** true なら役割にかかわらず更新・削除・設定変更をさせない。 */
  readOnly: boolean;
};

function toAuthenticatedStaff(staff: {
  id: string;
  name: string;
  role: StaffRole;
  access_level?: 'full' | 'read_only';
}): AuthenticatedStaff {
  return {
    id: staff.id,
    name: staff.name,
    role: staff.role,
    readOnly: staff.access_level === 'read_only',
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function authenticateAdminSession(
  c: Context<Env>,
  token: string | null,
): Promise<AuthenticatedStaff | null> {
  if (!token) return null;
  const staff = await getStaffByAdminSession(c.env.DB, await sha256Hex(token), new Date().toISOString());
  if (!staff) return null;
  return toAuthenticatedStaff(staff);
}

async function authenticateCookieToken(
  c: Context<Env>,
  token: string | null,
): Promise<AuthenticatedStaff | null> {
  const session = await authenticateAdminSession(c, token);
  if (session) return session;
  // Backward-compatible emergency session created by the hidden API-key route.
  return authenticateApiToken(c, token);
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

  // Some iOS/LINE WebViews reject the workers.dev cookie when the admin SPA
  // is hosted on pages.dev. In that cross-site topology the OAuth callback
  // hands the existing opaque admin-session token to the SPA via a URL
  // fragment, and the SPA presents it as a Bearer credential.
  if (token.startsWith(ADMIN_SESSION_BEARER_PREFIX)) {
    return authenticateAdminSession(c, token.slice(ADMIN_SESSION_BEARER_PREFIX.length));
  }

  const staff = await getStaffByApiKey(c.env.DB, token);
  if (staff) {
    return toAuthenticatedStaff(staff);
  }

  // Fallback: env API_KEY acts as owner (current rotation slot)
  if (token === c.env.API_KEY) {
    return { id: 'env-owner', name: 'Owner', role: 'owner', readOnly: false };
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
    return { id: 'env-owner', name: 'Owner', role: 'owner', readOnly: false };
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
  const method = c.req.method.toUpperCase();
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

  // A form definition is public because the LIFF client must render it before
  // submission. Authenticate opportunistically so the same GET can still
  // return the full admin representation to SDK/admin callers, while an
  // unauthenticated LIFF caller receives the redacted public representation.
  // Crucially, this exception is method-aware: PUT/DELETE on the same path
  // must continue through the normal admin authentication below.
  const isPublicFormDefinition =
    method === 'GET' && /^\/api\/forms\/[^/]+$/.test(path);
  if (isPublicFormDefinition) {
    const bearer = bearerToken(c);
    const cookie = adminSessionTokenFromCookie(c);
    const staff = bearer
      ? await authenticateApiToken(c, bearer)
      : await authenticateCookieToken(c, cookie);
    if (staff) c.set('staff', staff);
    return next();
  }

  // These LIFF actions perform their own LINE ID-token verification inside
  // the route. They cannot use the admin auth gate because their Bearer token
  // is a LINE ID token, not a Harness staff API key.
  const isPublicFormAction =
    method === 'POST' &&
    (/^\/api\/forms\/[^/]+\/submit$/.test(path) ||
      /^\/api\/forms\/[^/]+\/opened$/.test(path) ||
      /^\/api\/forms\/[^/]+\/partial$/.test(path));
  if (isPublicFormAction) return next();

  if (
    path === '/webhook' ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path === '/webhooks/xserver/support-email' ||
    path === '/api/public/nen/adopted-photos' ||
    path === '/api/public/nen/gallery-preview' ||
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
    path === '/api/auth/line' ||
    path === '/api/auth/line/callback' ||
    path.startsWith('/auth/') ||
    path === '/setup' ||
    path === '/api/integrations/stripe/webhook' ||
    path === '/api/integrations/eccube/events' ||
    path === '/api/integrations/eccube/columns' ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    path === '/api/meet-callback' || // Meet Harness completion callback
    path === '/api/qr' || // Public QR proxy — used by desktop landing pages
    path === '/api/health' // Liveness probe (update CLI / self-update verify)
  ) {
    return next();
  }

  const bearer = bearerToken(c);
  const cookie = adminSessionTokenFromCookie(c);
  const staff = bearer
    ? await authenticateApiToken(c, bearer)
    : await authenticateCookieToken(c, cookie);
  if (!staff) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  if (staff.readOnly && !SAFE_METHODS.has(method)) {
    return c.json({ success: false, error: '閲覧のみの権限では変更操作を実行できません' }, 403);
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
