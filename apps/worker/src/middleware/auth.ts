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

/**
 * Return the hash key of the existing opaque admin session for server-side
 * session context. API-key authentication deliberately returns null because
 * it has no admin_sessions row to update.
 */
export async function adminSessionTokenHashFromRequest(
  c: Context<Env>,
): Promise<string | null> {
  const bearer = bearerToken(c);
  if (bearer) {
    if (!bearer.startsWith(ADMIN_SESSION_BEARER_PREFIX)) return null;
    const token = bearer.slice(ADMIN_SESSION_BEARER_PREFIX.length);
    return token ? sha256Hex(token) : null;
  }
  const cookie = adminSessionTokenFromCookie(c);
  return cookie ? sha256Hex(cookie) : null;
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
  permissionKeys?: string[];
  assignedLineAccountId?: string | null;
  canAccessDescendantAccounts?: boolean;
  /** 所属する統括。認可への実適用は後続工程で行う。 */
  tenantId?: string | null;
};

function toAuthenticatedStaff(staff: {
  id: string;
  name: string;
  role: StaffRole;
  access_level?: 'full' | 'read_only';
  permission_keys?: string;
  assigned_line_account_id?: string | null;
  can_access_descendant_accounts?: number;
  tenant_id?: string | null;
}): AuthenticatedStaff {
  let permissionKeys: string[] = [];
  try { permissionKeys = staff.permission_keys ? JSON.parse(staff.permission_keys) as string[] : []; } catch { permissionKeys = []; }
  return {
    id: staff.id,
    name: staff.name,
    role: staff.role,
    readOnly: staff.access_level === 'read_only',
    permissionKeys,
    assignedLineAccountId: staff.assigned_line_account_id ?? null,
    canAccessDescendantAccounts: Boolean(staff.can_access_descendant_accounts),
    tenantId: staff.tenant_id ?? null,
  };
}

const STAFF_API_PERMISSIONS: Array<[string, string]> = [
  ['/api/inbox', '/chats'], ['/api/chats', '/chats'], ['/api/conversations', '/chats'],
  ['/api/support', '/chats'], ['/api/operators', '/chats'],
  ['/api/friends', '/friends'], ['/api/tags', '/tags'], ['/api/friend-fields', '/tags'],
  ['/api/tag-groups', '/tags'], ['/api/support-marks', '/tags'], ['/api/saved-searches', '/tags'], ['/api/folders', '/tags'],
  ['/api/scenarios', '/scenarios'], ['/api/broadcasts', '/broadcasts'], ['/api/reminders', '/reminders'],
  ['/api/auto-replies', '/auto-replies'], ['/api/auto-reply-runs', '/auto-replies'], ['/api/friend-add', '/friend-add-settings'], ['/api/webinars', '/webinars'],
  ['/api/templates', '/templates'], ['/api/rich-menu', '/rich-menus'], ['/api/forms', '/form-submissions'], ['/api/contents', '/contents'],
  ['/api/conversions', '/conversions'], ['/api/scoring', '/scoring'], ['/api/tracked-links', '/inflow-links'], ['/api/analytics', '/analytics'],
  ['/api/mileage', '/mileage'], ['/api/action-scores', '/mileage'],
  ['/api/automations', '/automations'], ['/api/automation-runs', '/automations'],
  ['/api/automation-templates', '/automations'], ['/api/automation-drafts', '/automations'],
  ['/api/automation-draft-resources', '/automations'], ['/api/common-actions', '/automations'],
  ['/api/webhooks', '/webhooks'], ['/api/booking', '/booking/bookings'], ['/api/events', '/events'],
  ['/api/nen-campaigns', '/nen-campaigns'], ['/api/nen-members', '/nen-members'], ['/api/ec-commerce', '/ec-commerce'],
];

/**
 * A few APIs live under /api/friends for URL compatibility but expose another
 * feature. Resolve them before the broad /api/friends prefix so a staff member
 * cannot inherit chat or friend-attribute access from the friends permission.
 */
const STAFF_API_PERMISSION_OVERRIDES: Array<[RegExp, string]> = [
  [/^\/api\/friends\/[^/]+\/messages(?:\/|$)/, '/chats'],
  [/^\/api\/friends\/[^/]+\/fields(?:\/|$)/, '/tags'],
  [/^\/api\/friends\/[^/]+\/support-mark(?:\/|$)/, '/tags'],
  [/^\/api\/friends\/support-mark\/bulk(?:\/|$)/, '/tags'],
];

function permissionForApiPath(path: string): string | null {
  const override = STAFF_API_PERMISSION_OVERRIDES.find(([pattern]) => pattern.test(path));
  if (override) return override[1];
  return STAFF_API_PERMISSIONS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? null;
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
    return { id: 'env-owner', name: 'Owner', role: 'owner', readOnly: false, permissionKeys: [], assignedLineAccountId: null, canAccessDescendantAccounts: true };
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
    return { id: 'env-owner', name: 'Owner', role: 'owner', readOnly: false, permissionKeys: [], assignedLineAccountId: null, canAccessDescendantAccounts: true };
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
    path === '/api/auth/two-factor/verify' ||
    /^\/api\/staff\/invitations\/[^/]+\/verify$/.test(path) ||
    path.startsWith('/auth/') ||
    path === '/setup' ||
    path === '/api/integrations/stripe/webhook' ||
    path === '/api/integrations/eccube/events' ||
    path === '/api/integrations/eccube/columns' ||
    // Codex clients sign the exact body with a dedicated shared secret.
    path === '/api/integrations/codex-slack/events' ||
    // Slack button actions are verified with the Slack app signing secret.
    path === '/api/integrations/slack/actions' ||
    // Slack Events are also verified with the Slack app signing secret.
    path === '/api/integrations/slack/events' ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    path === '/api/meet-callback' || // Meet Harness completion callback
    path === '/api/qr' || // Public QR proxy — used by desktop landing pages
    // ログイン画面の看板（公式アカウントの表示名とアイコン）。認証より手前の
    // 画面が読むので通す。返すのは LINE 上で公開されている2つの値だけ。
    path === '/api/public/brand' ||
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

  if (staff.role === 'staff') {
    const requiredPermission = permissionForApiPath(path);
    if (requiredPermission && !staff.permissionKeys?.includes(requiredPermission)) {
      return c.json({ success: false, error: 'この機能を操作する権限がありません' }, 403);
    }
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
