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
  /** 機能オフ middleware が一覧処理へ渡す、このリクエストだけの追加絞り込み。 */
  featureEnabledLineAccountIds?: string[];
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
  ['/api/tag-groups', '/tags'], ['/api/support-marks', '/tags'], ['/api/support-mark-rules', '/tags'],
  ['/api/saved-searches', '/tags'], ['/api/folders', '/tags'],
  ['/api/scenarios', '/scenarios'], ['/api/broadcasts', '/broadcasts'], ['/api/reminders', '/reminders'],
  ['/api/friend-reminders', '/reminders'], ['/api/reminder-runs', '/reminders'],
  ['/api/auto-replies', '/auto-replies'], ['/api/auto-reply-runs', '/auto-replies'], ['/api/friend-add', '/friend-add-settings'], ['/api/webinars', '/webinars'],
  ['/api/templates', '/templates'], ['/api/rich-menu', '/rich-menus'], ['/api/rich-menus', '/rich-menus'],
  ['/api/rich-menu-groups', '/rich-menus'], ['/api/rich-menu-images', '/rich-menus'],
  ['/api/forms', '/form-submissions'], ['/api/contents', '/contents'], ['/api/media', '/contents'],
  // 共通情報は登録メディアと同じ contents.ts 配下。メニューの href と同じ鍵を使う。
  ['/api/common-vars', '/contents/vars'],
  // 流入計測の入口経路と文面は /inflow-links 画面が呼ぶ。
  ['/api/entry-routes', '/inflow-links'], ['/api/entry-route-genres', '/inflow-links'],
  ['/api/message-templates', '/inflow-links'],
  ['/api/funnels', '/analytics'],
  // ダッシュボード(ホーム)の数字と表示設定。'/' 鍵はメニューの href と同じ。
  // /api/list-stats は複数画面の集計で帰属を決められないため登録しない
  // (fail-closed。N-423 の残課題として司令塔へ報告する)。
  ['/api/dashboard', '/'],
  ['/api/getting-started', '/getting-started'],
  ['/api/conversions', '/conversions'], ['/api/scoring', '/scoring'], ['/api/scoring-rules', '/scoring'],
  ['/api/tracked-links', '/inflow-links'], ['/api/analytics', '/analytics'],
  ['/api/mileage', '/mileage'], ['/api/action-scores', '/mileage'],
  ['/api/automations', '/automations'], ['/api/automation-runs', '/automations'],
  ['/api/automation-templates', '/automations'], ['/api/automation-drafts', '/automations'],
  ['/api/automation-draft-resources', '/automations'], ['/api/common-actions', '/automations'],
  ['/api/webhooks', '/webhooks'], ['/api/line-notifications', '/line-notifications'],
  ['/api/booking', '/booking/bookings'], ['/api/events', '/events'],
  // 個別相談の変更・取消は予約と同じ `/booking/bookings` 権限で守る
  // (N-065 #623 司令塔裁定。`/api/meet-callback` は公開コールバックのため対象外)。
  ['/api/meet-consultations', '/booking/bookings'],
  // 友だち追加時の配信ルールと実行記録。旧 `/api/friend-add` 項目に
  // 合う実経路は無いが、互換のため残す。
  ['/api/friend-add-rules', '/friend-add-settings'], ['/api/friend-add-runs', '/friend-add-settings'],
  ['/api/nen-campaigns', '/nen-campaigns'], ['/api/nen-members', '/nen-members'], ['/api/ec-commerce', '/ec-commerce'],
];

/**
 * A few APIs live under /api/friends for URL compatibility but expose another
 * feature. Resolve them before the broad /api/friends prefix so a staff member
 * cannot inherit chat or friend-attribute access from the friends permission.
 */
const STAFF_API_PERMISSION_OVERRIDES: Array<[RegExp, string]> = [
  [/^\/api\/nen-members\/photos\/decisions\/bulk(?:\/|$)/, 'photo.submission.bulk_review'],
  [/^\/api\/nen-members\/photos\/(?:original-download\/[^/]+|[^/]+\/original-download)(?:\/|$)/, 'photo.original.download'],
  [/^\/api\/nen-members\/photos\/[^/]+\/(?:assessments\/re-evaluate|assets\/process|review|notification\/retry)(?:\/|$)/, 'photo.submission.review'],
  [/^\/api\/nen-members\/photos(?:\/|$)/, 'photo.submission.view'],
  [/^\/api\/friends\/[^/]+\/messages(?:\/|$)/, '/chats'],
  [/^\/api\/friends\/[^/]+\/fields(?:\/|$)/, '/tags'],
  [/^\/api\/friends\/[^/]+\/support-mark(?:\/|$)/, '/tags'],
  [/^\/api\/friends\/support-mark\/bulk(?:\/|$)/, '/tags'],
];

export function permissionForApiPath(path: string): string | null {
  const override = STAFF_API_PERMISSION_OVERRIDES.find(([pattern]) => pattern.test(path));
  if (override) return override[1];
  return STAFF_API_PERMISSIONS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? null;
}

/**
 * 役割に関わらず認証済みなら通す本人・自組織・シェル必須の口。
 *
 * いずれも route 側で対象を絞っている: 自分の表示・自組織の名前・
 * 可視アカウントだけの一覧・秘密値を含まない版情報・自分の二段階認証
 * (handler 内で本人確認)・失敗報告の受付。exact 一致で列挙し、
 * 新しい口は fail-closed (staff 403) に倒す。
 */
const STAFF_SELF_ENDPOINTS: Array<[method: string, path: string]> = [
  ['GET', '/api/auth/session'],
  ['POST', '/api/auth/step-up'],
  ['GET', '/api/staff/me'],
  ['GET', '/api/tenants/me'],
  ['POST', '/api/client-errors'],
  ['GET', '/api/capabilities'],
  ['GET', '/api/line-accounts'],
  ['GET', '/api/line-accounts/summary'],
  // 殻の表示に要る機能設定の読み取り。更新は owner/admin 専用。
  ['GET', '/api/settings/features'],
  // 共通アップローダ。受信箱の 1 対 1 返信など staff の付与機能から使う。
  // 読み取りは公開の /images/* 経由で、鍵は機能 API の応答で渡る。
  ['POST', '/api/images'],
];

/**
 * `/api/staff/:id` 配下のうち handler 内で本人か管理者に絞っている口。
 * 一覧・招待・他人への操作は含めない。
 */
const STAFF_SELF_PATTERNS: Array<[method: string, pattern: RegExp]> = [
  // 自分の表示・自分の設定変更。handler が本人または管理者に絞る。
  ['GET', /^\/api\/staff\/[^/]+$/],
  ['PATCH', /^\/api\/staff\/[^/]+$/],
  // 自分の二段階認証の設定・確定・解除。handler が本人に絞る。
  ['POST', /^\/api\/staff\/[^/]+\/two-factor(?:\/[^/]+)?$/],
  ['DELETE', /^\/api\/staff\/[^/]+\/two-factor(?:\/[^/]+)?$/],
];

export function isStaffSelfEndpoint(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if (STAFF_SELF_ENDPOINTS.some(([m, p]) => m === normalizedMethod && p === path)) return true;
  return STAFF_SELF_PATTERNS.some(([m, pattern]) => m === normalizedMethod && pattern.test(path));
}

/**
 * route が staff へ明示許可している既存の口の写し。
 *
 * 旧一覧の GET /api/staff は handler が他人のメールを伏せる意図的な
 * 仕様として維持する(司令塔裁定 #670)。飲食店テストは点検対象外の
 * ため route の明示許可を写すだけで、闇雲に広げない。
 */
const STAFF_EXPLICIT_ALLOW: Array<[method: string, path: string]> = [
  ['GET', '/api/staff'],
  ['GET', '/api/restaurant-test/stores'],
  ['GET', '/api/restaurant-test/store-context'],
  ['GET', '/api/restaurant-test/terms-agreement'],
  ['POST', '/api/restaurant-test/stores/selection/clear'],
  ['GET', '/api/restaurant-test/snapshot'],
  ['POST', '/api/restaurant-test/reservations/manual'],
];

const STAFF_EXPLICIT_ALLOW_PATTERNS: Array<[method: string, pattern: RegExp]> = [
  ['POST', /^\/api\/restaurant-test\/stores\/[^/]+\/select$/],
];

export function isStaffExplicitAllow(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if (STAFF_EXPLICIT_ALLOW.some(([m, p]) => m === normalizedMethod && p === path)) return true;
  return STAFF_EXPLICIT_ALLOW_PATTERNS.some(([m, pattern]) => m === normalizedMethod && pattern.test(path));
}

/**
 * 管理者認証より手前へ通す公開境界。authMiddleware の skip 判定と
 * 同じ意味で、method を区別する口もここで扱う。
 */
export function isPublicApiBoundary(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase();
  // フォーム定義の GET は LIFF が認証なしで読む。PUT/DELETE は管理 API。
  if (normalizedMethod === 'GET' && /^\/api\/forms\/[^/]+$/.test(path)) return true;
  // LIFF の回答・開封・途中保存は route 側で LINE 署名を見る。
  if (
    normalizedMethod === 'POST' &&
    (/^\/api\/forms\/[^/]+\/submit$/.test(path) ||
      /^\/api\/forms\/[^/]+\/opened$/.test(path) ||
      /^\/api\/forms\/[^/]+\/partial$/.test(path))
  ) {
    return true;
  }
  return (
    path === '/webhook' ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path === '/webhooks/xserver/support-email' ||
    path === '/api/public/nen/adopted-photos' ||
    path === '/api/public/nen/gallery-preview' ||
    path === '/api/site/collect' ||
    path === '/api/site/script.js' ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/pool/') ||
    path.startsWith('/images/') ||
    path.startsWith('/api/liff/') ||
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
    path === '/api/internal/deployments/events' ||
    path === '/api/integrations/codex-slack/events' ||
    path === '/api/integrations/slack/actions' ||
    path === '/api/integrations/slack/events' ||
    /^\/api\/webhooks\/incoming\/[^/]+\/receive$/.test(path) ||
    path === '/api/meet-callback' ||
    path === '/api/qr' ||
    path === '/api/public/brand' ||
    path === '/api/health'
  );
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

  // 公開境界(LIFF・webhook・署名検証の入口)は認証より手前へ通す。
  // 判定の中身は isPublicApiBoundary に集約し、契約テストと共有する。
  // (LIFF の回答系は route 側で LINE 署名を見るため管理認証の対象外)
  if (isPublicApiBoundary(method, path)) return next();

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

  // N-423 (#670): staff は deny-by-default。権限表に無い管理 API は
  // 本人・自組織と明示許可の口以外すべて 403。owner/admin は従来どおり通す。
  if (staff.role === 'staff' && !isStaffSelfEndpoint(method, path) && !isStaffExplicitAllow(method, path)) {
    const requiredPermission = permissionForApiPath(path);
    if (!requiredPermission || !staff.permissionKeys?.includes(requiredPermission)) {
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
