export type { ImpersonationContext } from './impersonation-types.js';
import type { ImpersonationContext } from './impersonation-types.js';
import type { Context, MiddlewareHandler } from 'hono';
import {
  getActiveImpersonation,
  recordAuditEvent,
  getPlatformAdminByStaffId,
  type ImpersonationSession,
} from '@line-crm/db';

import type { Env } from '../worker-env.js';
import { adminSessionTokenHashFromRequest } from './auth/credentials/auth.js';
import type { AuthenticatedStaff } from './auth/principal/auth.js';

const EXEMPT_PREFIXES = ['/api/ops/', '/api/auth/'];

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
  const sessionTokenHash = await adminSessionTokenHashFromRequest(c);
  if (!sessionTokenHash) return null;
  const session = await getActiveImpersonation(c.env.DB, staff.id, sessionTokenHash);
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

/** Classify fields independently of URL; new admin routes inherit protection. */
const NAME_KEYS = new Set(['ownername', 'personname', 'displayname', 'systemdisplayname', 'realname', 'friendname', 'fullname', 'customername', 'staffname', 'recipientname', 'firstname', 'lastname', 'bankaccountholder', 'furigana', 'kana']);
const CONTACT_KEYS = new Set(['pictureurl', 'phone', 'phonenumber', 'email', 'emailaddress', 'address', 'postalcode', 'zipcode', 'birthdate', 'birthday', 'dateofbirth', 'lineuserid', 'allergies', 'allergy', 'accountnumber', 'bankaccountnumber', 'filename', 'r2key', 'downloadurl', 'contenturl', 'originalurl', 'attachmenturl', 'customeremail', 'customerphone', 'recipientemail', 'recipientphone', 'contactemail', 'contactphone', 'phonee164', 'addressline1', 'addressline2', 'city', 'prefecture', 'bankcode', 'branchcode', 'accountlast4', 'url', 'uri', 'imageurl', 'avatarurl', 'thumbnailurl', 'originalcontenturl', 'previewimageurl']);
const TEXT_KEYS = new Set(['alttext', 'subject', 'caption', 'snippet', 'usercomment', 'friendcomment', 'notificationtext', 'reason', 'text', 'content', 'message', 'body', 'lastmessage', 'preview', 'customernote', 'internalnote', 'note', 'memo', 'description']);
// Arbitrary answers/metadata cannot be safely classified by their nested keys.
const OPAQUE_KEYS = new Set(['metadata', 'metadatajson', 'answers', 'answer', 'fieldvalues', 'customfields', 'formdata', 'profile', 'payload']);
function fieldKey(key: string): string { return key.replace(/[_-]/g, '').toLowerCase(); }

export function shouldMaskPii(path: string): boolean {
  return path.startsWith('/api/') && !path.startsWith('/api/auth/');
}

function maskOpaque(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return [];
  if (typeof value === 'object') return {}; // arbitrary keys can also contain PII
  return typeof value === 'number' ? 0 : typeof value === 'boolean' ? false : '（代理ログイン中は伏せています）';
}

export function isSensitiveFilePath(path: string): boolean {
  return /(?:\.csv|\/export(?:\/|$)|\/exports\/[^/]+\/download|\/download(?:\/|$)|\/form-files\/[^/]+\/content)$/.test(path);
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
  if (value === null || typeof value !== 'object') return value;
  if (depth > 64) return null; // Never return an unexamined subtree.
  if (Array.isArray(value)) return value.map((item) => maskPiiDeep(item, depth + 1));
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const person = Object.keys(source).some(key => ['friendid', 'lineuserid', 'realname', 'customername', 'customerid', 'email', 'phonenumber', 'phone', 'fieldid', 'submissionid', 'ownername', 'personname', 'displayname', 'systemdisplayname', 'friendname', 'fullname', 'recipientname', 'pictureurl', 'role', 'rolebundle'].includes(fieldKey(key)));
  const id = source.id ?? source.friend_id ?? source.friendId ?? source.line_user_id ?? source.lineUserId;
  for (const [key, raw] of Object.entries(source)) {
    const classified = fieldKey(key);
    if ((NAME_KEYS.has(classified) || (classified === 'name' && person)) && typeof raw === 'string') {
      out[key] = maskedFriendLabel(id);
    } else if (OPAQUE_KEYS.has(classified) || (person && ['data', 'value', 'values', 'valuejson', 'valuetext'].includes(classified))) {
      out[key] = maskOpaque(raw);
    } else if (CONTACT_KEYS.has(classified)) {
      out[key] = raw === null || raw === undefined ? raw : Array.isArray(raw) ? [] : typeof raw === 'object' ? {} : typeof raw === 'number' ? 0 : typeof raw === 'boolean' ? false : '';
    } else if (TEXT_KEYS.has(classified) && typeof raw === 'string' && raw.length > 0) {
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
async function auditPiiOutput(c: Context<Env>, result: 'success' | 'denied', kind: 'json' | 'file') {
  const impersonation = c.get('impersonation');
  const staff = c.get('staff');
  if (!impersonation) return;
  await recordAuditEvent(c.env.DB, { tenantId: impersonation.tenantId, category: 'auth',
    action: 'impersonation.pii.output', actorPrincipalId: staff.id, actorRole: staff.role,
    targetKind: 'impersonation', targetId: impersonation.id, result, riskLevel: 'high',
    after: { format: kind }, retentionClass: 'security' });
}

export const piiMaskMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  let impersonation = c.get('impersonation');
  // Ops keeps the operator's original authority, but is still an output while
  // that session impersonates someone. Mask its broad console data regardless
  // of a reveal granted only for the target organization's customer APIs.
  if (!impersonation && c.req.path.startsWith('/api/ops/') && c.get('staff')) {
    const tokenHash = await adminSessionTokenHashFromRequest(c);
    const active = tokenHash ? await getActiveImpersonation(c.env.DB, c.get('staff').id, tokenHash) : null;
    if (active) { impersonation = { ...toImpersonationContext(active), piiRevealed: false }; c.set('impersonation', impersonation); }
  }
  if (!impersonation || !shouldMaskPii(c.req.path)) return next();
  if (!impersonation.piiRevealed && isSensitiveFilePath(c.req.path)) {
    await auditPiiOutput(c, 'denied', 'file');
    return c.json({ success: false, error: '代理ログイン中の書き出し・書類取得には理由付きの個人情報表示の許可が必要です' }, 403);
  }
  await next();
  const contentType = c.res.headers.get('content-type') ?? '';
  const json = contentType.includes('application/json');
  c.header('Cache-Control', 'private, no-store');
  if (impersonation.piiRevealed) {
    await auditPiiOutput(c, c.res.status < 400 ? 'success' : 'denied', json ? 'json' : 'file');
    return;
  }
  if (!json) {
    await auditPiiOutput(c, 'denied', 'file');
    c.res = c.json({ success: false, error: '代理ログイン中はファイルを取得できません' }, 403);
    return;
  }
  let payload: unknown;
  try { payload = await c.res.clone().json(); }
  catch {
    c.res = c.json({ success: false, error: '個人情報を伏せられませんでした' }, 503);
    return;
  }
  const headers = new Headers(c.res.headers);
  headers.delete('content-length');
  headers.delete('etag');
  c.res = new Response(JSON.stringify(maskPiiDeep(payload)), { status: c.res.status, headers });
};

// ---------------------------------------------------------------------------
// 代理ログインでもできないこと（要件 §3 37-5 / 9 章の仮置き）
//   解約・権限者の削除・LINE 公式アカウントの削除
// ---------------------------------------------------------------------------

const FORBIDDEN_WHILE_IMPERSONATING: Array<[string, RegExp]> = [
  ['POST', /^\/api\/chats\/[^/]+\/(?:send|send-combined|messages|schedule)$/],
  ['POST', /^\/api\/(?:hq\/)?broadcasts\/[^/]+\/(?:send|correction)$/],
  ['POST', /^\/v2\/bot\/message\//],
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
