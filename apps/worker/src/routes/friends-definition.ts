import { serializeFriend } from './friend-display.js';
import { sqlIdSet } from '@line-crm/db/id-queries';
import { inputError } from '../lib/input-errors.js';
import { type Context, type MiddlewareHandler } from 'hono';
import { getFriendById, jstNow, validateSearchConditions } from '@line-crm/db';
import type { Friend as DbFriend, Tag as DbTag, SavedSearch, SavedSearchAccess, FriendFormSubmission } from '@line-crm/db';




import type { Env } from '../worker-env.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { isValidIdempotencyKey } from '../services/outbound-idempotency.js';
import { getSavedSearchMatchPreview } from '../services/saved-search-insights.js';

export async function adminAccountScope(c: Context<Env>, alias = '') {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const column = `${alias}line_account_id`;
  const where = scope.allowedAccountIds.length
    ? `(${column} IN (${sqlIdSet(scope.allowedAccountIds).sql})${scope.canSeeUnassigned ? ` OR ${column} IS NULL` : ''})`
    : scope.canSeeUnassigned
      ? `${column} IS NULL`
      : '1 = 0';
  return { scope, where, binds: scope.allowedAccountIds.length ? sqlIdSet(scope.allowedAccountIds).binds : [] };
}

/**
 * 利用者入力を LIKE パターンに埋める前の逃がし (#496-18)。
 *
 * `%` / `_` をそのまま渡すとワイルドカードとして効いて過剰一致する
 * （注入ではなく人数・ページ送りのぶれ）。`\` も逃がしたうえで、
 * 使う側はすべて `ESCAPE '\'` を付ける。
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export const requireVisibleFriend: MiddlewareHandler<Env> = async (c, next) => {
  const friend = await getFriendById(c.env.DB, c.req.param('id') ?? '');
  const accountId = friend
    ? ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null
    : null;
  if (!friend || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Friend not found' }, 404);
  }
  await next();
};

export const requireIdempotencyKey: MiddlewareHandler<Env> = async (c, next) => {
  if (!isValidIdempotencyKey(c.req.header('Idempotency-Key')?.trim())) {
    return c.json({ success: false, error: '有効なIdempotency-Keyが必要です' }, 400);
  }
  await next();
};

export /**
 * Friend serializer for the list endpoint. Adds firstTrackedLinkName +
 * chatStatus from the JOINed query, present only when the caller opted into
 * the chat-status path (?includeChatStatus=true). When absent, the fields
 * default to nullish so the response shape stays consistent for clients that
 * don't request them.
 */
function serializeFriendListRow(
  row: DbFriend & {
    first_tracked_link_name?: string | null;
    chat_status?: string | null;
    operator_id?: string | null;
    operator_name?: string | null;
    support_mark_id?: string | null;
    support_mark_name?: string | null;
    support_mark_color?: string | null;
  },
  includeChatStatus: boolean,
) {
  const base = serializeFriend(row);
  if (!includeChatStatus) return base;
  return {
    ...base,
    // L-step style "ASP_LP名" — the campaign/landing-page name the friend
    // entered through, attributed once at friend-add time and never
    // overwritten (see migration 022). LEFT JOINed in the list query.
    firstTrackedLinkName: row.first_tracked_link_name ?? null,
    // chats.status defaulted to 'resolved' for friends without a chats row
    // (matches /api/chats listing). Friend-list and chats-list now agree on
    // 未対応/対応中/対応済み state.
    chatStatus: (row.chat_status ?? 'resolved') as 'unread' | 'in_progress' | 'resolved',
    operatorId: row.operator_id ?? null,
    operatorName: row.operator_name ?? null,
    supportMarkId: row.support_mark_id ?? null,
    supportMarkName: row.support_mark_name ?? null,
    supportMarkColor: row.support_mark_color ?? null,
  };
}

export /** Convert a D1 snake_case Tag row to the shared camelCase shape */
function serializeTag(row: DbTag) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  };
}

export async function friendSavedViewAccess(c: Context<Env>): Promise<SavedSearchAccess | Response> {
  const lineAccountId = c.req.query('lineAccountId');
  if (!lineAccountId) {
    return inputError(c, { success: false, error: 'LINE公式アカウントを選んでください' }, 400, ["lineAccountId"]);
  }
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!scope.allowedAccountIds.includes(lineAccountId)) {
    return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
  }
  const staff = c.get('staff');
  return {
    lineAccountId,
    staffId: staff.id,
    canManageAll: staff.role === 'owner' || staff.role === 'admin',
  };
}

export async function serializeFriendSavedView(db: D1Database, row: SavedSearch) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.conditions_json);
  } catch {
    parsed = null;
  }
  const validated = validateSearchConditions(parsed);
  const match = validated.ok && row.line_account_id
    ? await getSavedSearchMatchPreview(db, validated.value, row.line_account_id)
    : {
        total: null,
        byChannel: { line: null, mail: null },
        calculatedAt: jstNow(),
        error: validated.ok ? 'LINE公式アカウントを確認できません' : validated.error,
      };
  return {
    id: row.id,
    name: row.name,
    conditions: parsed,
    revision: Number(row.revision ?? 1),
    isShared: Boolean(row.is_shared),
    ownerId: row.created_by,
    lineAccountId: row.line_account_id,
    displayOrder: row.display_order,
    match,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

export /** 回答1件の画面向け形。詳細の同梱と履歴タブの口で同じ形にする。 */
function serializeFriendFormSubmission(submission: FriendFormSubmission) {
  return {
    id: submission.id,
    formId: submission.form_id,
    formName: submission.form_name,
    fields: JSON.parse(submission.form_fields || '[]') as unknown[],
    data: JSON.parse(submission.data || '{}') as Record<string, unknown>,
    createdAt: submission.created_at,
  };
}
