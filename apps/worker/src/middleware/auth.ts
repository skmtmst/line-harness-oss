import { rememberAuthenticatedStaffRecord } from '../lib/authenticated-staff-record.js';
import { logger } from '@line-crm/shared/server';
/** Public auth facade. Internal auth.ts modules retain the existing manual-review gate. */
import { bearerToken } from './auth-http.js';
import { isPublicApiBoundary, isPublicFormDefinition } from './public-api-boundary.js';
import { mfaEncryptionConfigured } from '../lib/mfa-config.js';
import type { Context, Next } from 'hono';
import { deleteAdminSession, getPlatformSetting, getStaffByAdminSession, getStaffByApiKey } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { isForbiddenWhileImpersonating, resolveImpersonation } from './impersonation.js';
import { isOutputRequest } from './output-request.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { ADMIN_SESSION_BEARER_PREFIX, CSRF_HEADER, adminSessionTokenFromCookie, csrfTokenFromCookie, sha256Hex } from './auth/credentials/auth.js';
import { toAuthenticatedStaff, isTenantUnavailable, isTenantSuspensionExemptPath, TENANT_SUSPENDED_CODE, TENANT_SUSPENDED_ERROR, type AuthenticatedStaff } from './auth/principal/auth.js';
import { gap2ReadOperation, gap2SelfPreference, permissionForApiPath, isStaffSelfEndpoint, isStaffExplicitAllow } from './auth/permissions/auth.js';

export { ADMIN_AUTH_COOKIE, ADMIN_SESSION_BEARER_PREFIX, CSRF_COOKIE, CSRF_HEADER, SESSION_DEFAULT_MAX_AGE, SESSION_REMEMBER_MAX_AGE, SESSION_MAX_AGE, adminSessionTokenHashFromRequest, adminSessionTokenFromCookie, csrfTokenFromCookie, adminSessionCookie, csrfCookie, expiredCookie, sha256Hex } from './auth/credentials/auth.js';
export { toAuthenticatedStaff, isTenantUnavailable, isTenantSuspensionExemptPath, TENANT_SUSPENDED_CODE, TENANT_SUSPENDED_ERROR, type AuthenticatedStaff, type StaffRole, type TenantStatus } from './auth/principal/auth.js';
export { gap2ReadOperation, permissionForApiPath, isStaffSelfRouteTemplate, isStaffSelfEndpoint, isStaffExplicitAllow } from './auth/permissions/auth.js';
export { isPublicApiBoundary } from './public-api-boundary.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function authenticateAdminSession(
  c: Context<Env>,
  token: string | null,
): Promise<AuthenticatedStaff | null> {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const staff = await getStaffByAdminSession(c.env.DB, tokenHash, new Date().toISOString());
  if (!staff) return null;
  const configured = mfaEncryptionConfigured(c.env.TOTP_ENCRYPTION_KEY);
  const registered = Boolean(staff.totp_enabled_at && staff.totp_secret_enc);
  // 方針と確認済みの印は独立。未登録者の印は読んでも許可できないので取らない。
  const [policy, verified] = await Promise.all([
    configured ? getPlatformSetting(c.env.DB, `auth.mfa.required:${staff.tenant_id ?? DEFAULT_TENANT_ID}`) : null,
    registered ? getPlatformSetting(c.env.DB, `auth.mfa.session:${tokenHash}`) : null,
  ]);
  const required = configured && policy !== 'false';
  if ((required && !registered) || (registered && verified !== staff.id)) {
    await deleteAdminSession(c.env.DB, tokenHash);
    return null;
  }
  return rememberAuthenticatedStaffRecord(c.env.DB, { ...toAuthenticatedStaff(staff), credential: 'session' }, staff);
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
    const required = mfaEncryptionConfigured(c.env.TOTP_ENCRYPTION_KEY) && await getPlatformSetting(c.env.DB, `auth.mfa.required:${staff.tenant_id ?? DEFAULT_TENANT_ID}`) !== 'false';
    // This endpoint exchanges the primary credential for a challenge, never
    // for an authenticated staff context usable by other APIs.
    if (c.req.path !== '/api/auth/login' && (required || staff.totp_enabled_at)) return null;
    return rememberAuthenticatedStaffRecord(c.env.DB, { ...toAuthenticatedStaff(staff), credential: 'api-key' }, staff);
  }

  // Fallback: env API_KEY acts as owner (current rotation slot)
  if (token === c.env.API_KEY) {
    if (mfaEncryptionConfigured(c.env.TOTP_ENCRYPTION_KEY) && await getPlatformSetting(c.env.DB, `auth.mfa.required:${DEFAULT_TENANT_ID}`) !== 'false') return null;
    return { id: 'env-owner', name: 'Owner', role: 'owner', readOnly: false, permissionKeys: [], assignedLineAccountId: null, canAccessDescendantAccounts: true, tenantStatus: 'active', credential: 'api-key' };
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
    if (mfaEncryptionConfigured(c.env.TOTP_ENCRYPTION_KEY) && await getPlatformSetting(c.env.DB, `auth.mfa.required:${DEFAULT_TENANT_ID}`) !== 'false') return null;
    logger.log("auth_accept_via_LEGACY_API_KEY");
    return { id: 'env-owner', name: 'Owner', role: 'owner', readOnly: false, permissionKeys: [], assignedLineAccountId: null, canAccessDescendantAccounts: true, tenantStatus: 'active', credential: 'api-key' };
  }

  return null;
}

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Skip auth for the LINE webhook endpoint — it uses signature verification instead
  // Skip auth for OpenAPI docs — public documentation
  const path = c.req.path;
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
  const publicForm = isPublicFormDefinition(method, path);
  if (publicForm && !c.req.query('account_id')) {
    const bearer = bearerToken(c);
    const cookie = adminSessionTokenFromCookie(c);
    const staff = bearer
      ? await authenticateApiToken(c, bearer)
      : await authenticateCookieToken(c, cookie);
    if (staff) c.set('staff', staff);
    return next();
  }

  // 公開境界(LIFF・webhook・署名検証の入口)は認証より手前へ通す。
  // 判定の中身は isPublicApiBoundary に集約し、契約テストと共有する。
  // (LIFF の回答系は route 側で LINE 署名を見るため管理認証の対象外)
  if (isPublicApiBoundary(method, path) && !(publicForm && c.req.query('account_id'))) return next();

  const bearer = bearerToken(c);
  const cookie = adminSessionTokenFromCookie(c);
  let staff = bearer
    ? await authenticateApiToken(c, bearer)
    : await authenticateCookieToken(c, cookie);
  if (!staff) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  // 代理ログイン（★37-5）。運営マスターが契約先の画面に入っている間だけ、
  // 見ている統括を差し替える。既定は閲覧のみなので、この直後の readOnly 判定に乗る。
  const impersonated = await resolveImpersonation(c, staff, path);
  if (impersonated) {
    staff = impersonated.staff;
    c.set('impersonation', impersonated.context);
    if (isForbiddenWhileImpersonating(method, path)) {
      return c.json({ success: false, error: '代理ログイン中はこの操作はできません（解約・権限者の削除・LINEアカウントの削除）' }, 403);
    }
  }

  // 契約先の停止・保管は画面非表示ではなく、すべての管理APIの共通境界で
  // 強制する。運営マスターによる有効な代理ログインだけは閲覧を継続できる。
  if (!impersonated
      && isTenantUnavailable(staff.tenantStatus)
      && !isTenantSuspensionExemptPath(method, path)) {
    return c.json({ success: false, code: TENANT_SUSPENDED_CODE, error: TENANT_SUSPENDED_ERROR }, 403);
  }

  if (staff.readOnly && !SAFE_METHODS.has(method) && !gap2ReadOperation(method,path) && !gap2SelfPreference(method,path)) {
    return c.json({ success: false, error: '閲覧のみの権限では変更操作を実行できません' }, 403);
  }

  const outputRequest = isOutputRequest(path, c.req.query('format'), method);
  if (staff.readOnly && outputRequest && !(path==='/api/hq/store-comparison/export'||/^\/api\/hq\/store-comparison\/exports\/[^/]+\/download$/.test(path))) {
    return c.json({ success: false, error: '閲覧のみの権限では書き出しを実行できません' }, 403);
  }

  // N-423 (#670): staff は deny-by-default。権限表に無い管理 API は
  // 本人・自組織と明示許可の口以外すべて 403。owner/admin は従来どおり通す。
  // 運営メンバーは、運営会社の統括に属する通常の staff として作る。
  // /api/ops/* は直後の route 側で requirePlatformAdmin が全件を守るため、
  // ここで通常スタッフ向けの画面権限へ落とすと、登録済みの運営メンバーまで
  // 専用判定へ到達する前に 403 になる。運営 API だけは専用の門番へ委ねる。
  const usesPlatformAdminAuthorization = path.startsWith('/api/ops/') || path === '/api/auth/two-factor/policy';
  if (staff.role === 'staff'
      && !usesPlatformAdminAuthorization
      && !isStaffSelfEndpoint(method, path, staff.id)
      && !isStaffExplicitAllow(method, path)) {
    const requiredPermission = permissionForApiPath(path);
    // N-424: 「見えるだけ」の key は GET系だけを許可する。変更系は edit の key が要る。
    const granted = requiredPermission
      && (staff.permissionKeys?.includes(requiredPermission)
        || ((SAFE_METHODS.has(method)||gap2ReadOperation(method,path)) && !outputRequest && staff.viewPermissionKeys?.includes(requiredPermission)));
    if (!requiredPermission || !granted) {
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
