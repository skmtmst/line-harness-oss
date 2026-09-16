import type { Context, MiddlewareHandler } from 'hono';
import {
  getActiveImpersonation,
  getPlatformAdminByStaffId,
  type ImpersonationSession,
} from '@line-crm/db';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from './auth.js';

/**
 * 代理ログイン（★V6 37-5）。
 *
 * 運営マスターが契約先（統括）の画面に入るとき、通常の認証で得た本人の
 * 身元はそのままに、「どの統括として見ているか」だけを差し替える。
 *
 * - 既定は閲覧のみ。readOnly を立てて、既存の authMiddleware の
 *   「閲覧のみは更新不可」の判定にそのまま乗せる
 * - 書き込みは理由を入れて切り替えたときだけ readOnly を外す
 * - 運営コンソール自身の API（/api/ops/*）と認証（/api/auth/*）には
 *   差し替えを掛けない。「代理ログインを終える」が閲覧モードでも押せるように
 *
 * 記録（監査・契約先側の履歴）はルート側で行う。ここは身元の差し替えだけ。
 */

export interface ImpersonationContext {
  id: string;
  tenantId: string;
  mode: 'read' | 'write';
  piiRevealed: boolean;
  startedAt: string;
}

const EXEMPT_PREFIXES = ['/api/ops/', '/api/auth/', '/api/admin/'];

export function isImpersonationExemptPath(path: string): boolean {
  return EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function toImpersonationContext(session: ImpersonationSession): ImpersonationContext {
  return {
    id: session.id,
    tenantId: session.tenant_id,
    mode: session.mode,
    piiRevealed: session.pii_revealed === 1,
    startedAt: session.started_at,
  };
}

/**
 * 認証済みの staff に有効な代理ログインがあれば、統括を差し替えた staff を返す。
 * 無ければ null。
 */
export async function resolveImpersonation(
  c: Context<Env>,
  staff: AuthenticatedStaff,
  path: string,
): Promise<{ staff: AuthenticatedStaff; context: ImpersonationContext } | null> {
  if (isImpersonationExemptPath(path)) return null;
  // env API_KEY で入った擬似オーナーには行が無い。
  if (staff.id === 'env-owner') return null;
  const session = await getActiveImpersonation(c.env.DB, staff.id);
  if (!session) return null;
  // 運営マスターでなくなっていたら（停止された等）、差し替えは無効にする。
  const admin = await getPlatformAdminByStaffId(c.env.DB, staff.id);
  if (!admin) return null;

  const context = toImpersonationContext(session);
  return {
    context,
    staff: {
      ...staff,
      role: 'owner',
      readOnly: context.mode === 'read',
      tenantId: context.tenantId,
      assignedLineAccountId: null,
      canAccessDescendantAccounts: true,
      permissionKeys: staff.permissionKeys ?? [],
    },
  };
}

// ---------------------------------------------------------------------------
// 個人情報の伏せ字（要件 §3 37-5 / §6-6）
// ---------------------------------------------------------------------------

/** 友だち・会話を返す API。代理ログイン中はここだけ伏せる。 */
const PII_MASK_PREFIXES = [
  '/api/friends',
  '/api/chats',
  '/api/inbox',
  '/api/conversations',
  '/api/support',
  '/api/nen-members',
  '/api/form-submissions',
  '/api/forms/',
];

const NAME_KEYS = new Set(['display_name', 'displayName', 'friend_name', 'friendName', 'full_name', 'fullName']);
const DROP_KEYS = new Set(['picture_url', 'pictureUrl', 'phone', 'phone_number', 'email', 'address', 'postal_code']);
const TEXT_KEYS = new Set(['text', 'content', 'message', 'body', 'last_message', 'lastMessage', 'preview']);

export function shouldMaskPii(path: string): boolean {
  return PII_MASK_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function maskedFriendLabel(id: unknown): string {
  const tail = typeof id === 'string' && id.length >= 4 ? id.slice(-4) : '----';
  return `友だち#${tail}`;
}

/**
 * JSON の木を歩き、氏名・連絡先・本文を伏せる。
 * 構造は変えない（画面が壊れないように）。値だけ差し替える。
 */
export function maskPiiDeep(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => maskPiiDeep(item, depth + 1));
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const id = source.id ?? source.friend_id ?? source.friendId ?? source.line_user_id ?? source.lineUserId;
  for (const [key, raw] of Object.entries(source)) {
    if (NAME_KEYS.has(key) && typeof raw === 'string') {
      out[key] = maskedFriendLabel(id);
    } else if (DROP_KEYS.has(key)) {
      out[key] = raw === null || raw === undefined ? raw : '';
    } else if (TEXT_KEYS.has(key) && typeof raw === 'string' && raw.length > 0) {
      out[key] = '（代理ログイン中は伏せています）';
    } else {
      out[key] = maskPiiDeep(raw, depth + 1);
    }
  }
  return out;
}

/**
 * 代理ログイン中で、個人情報の表示を許可していないときだけ、応答を伏せる。
 * authMiddleware の後ろに置く（c.get('impersonation') を読むため）。
 */
export const piiMaskMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  await next();
  const impersonation = c.get('impersonation');
  if (!impersonation || impersonation.piiRevealed) return;
  if (!shouldMaskPii(c.req.path)) return;
  const contentType = c.res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return;
  let payload: unknown;
  try {
    payload = await c.res.clone().json();
  } catch {
    return;
  }
  const masked = maskPiiDeep(payload);
  const headers = new Headers(c.res.headers);
  headers.delete('content-length');
  c.res = new Response(JSON.stringify(masked), { status: c.res.status, headers });
};

// ---------------------------------------------------------------------------
// 代理ログインでもできないこと（要件 §3 37-5 / 9 章の仮置き）
//   解約・権限者の削除・LINE 公式アカウントの削除
// ---------------------------------------------------------------------------

const FORBIDDEN_WHILE_IMPERSONATING: Array<[string, RegExp]> = [
  ['DELETE', /^\/api\/staff(?:\/|$)/],
  ['DELETE', /^\/api\/line-accounts(?:\/|$)/],
  ['DELETE', /^\/api\/accounts(?:\/|$)/],
  ['POST', /^\/api\/hq\/billing\/(?:portal|cancel)(?:\/|$)/],
  ['PATCH', /^\/api\/tenants\/[^/]+\/status(?:\/|$)/],
];

export function isForbiddenWhileImpersonating(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  return FORBIDDEN_WHILE_IMPERSONATING.some(([m, re]) => m === upper && re.test(path));
}
