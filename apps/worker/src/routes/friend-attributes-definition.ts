import { inputError } from '../lib/input-errors.js';
import { type Context } from 'hono';
import { createSavedSearch, jstNow, validateSearchConditions, validateSavedSegmentConditions, type SupportMarkWithUsage, type SupportMarkScope, type SavedSearch, type SavedSearchAccess, type SavedSearchConditionFormat, type SavedSearchReference, type Folder } from '@line-crm/db';




import type { Env } from '../worker-env.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { getSavedSearchMatchPreview, type SavedSearchMatchInsight, type SavedSearchMatchPreview } from '../services/saved-search-insights.js';
import { SUPPORT_MARK_RULE_EVENTS, type SaveSupportMarkAutomationRule, type SupportMarkRuleEvent } from '../services/support-mark-automation.js';
import { buildSegmentWhere } from '../services/segment-query.js';
import { type SegmentCondition } from '@line-crm/shared';

export function serializeMarkImpact(row: SupportMarkWithUsage) {
  return {
    friendCount: Number(row.friend_count),
    usedIn: {
      broadcasts: Number(row.broadcasts),
      scenarios: Number(row.scenarios),
      autoReplies: Number(row.auto_replies),
      savedSearches: Number(row.saved_searches),
      automations: Number(row.automations),
    },
  };
}

export function markReferenceCount(row: SupportMarkWithUsage): number {
  return Number(row.broadcasts)
    + Number(row.scenarios)
    + Number(row.auto_replies)
    + Number(row.saved_searches)
    + Number(row.automations);
}

export function sameMarkImpact(
  expected: unknown,
  current: ReturnType<typeof serializeMarkImpact>,
): boolean {
  if (!expected || typeof expected !== 'object') return false;
  const value = expected as { friendCount?: unknown; usedIn?: Record<string, unknown> };
  return Number(value.friendCount) === current.friendCount
    && Number(value.usedIn?.broadcasts) === current.usedIn.broadcasts
    && Number(value.usedIn?.scenarios) === current.usedIn.scenarios
    && Number(value.usedIn?.autoReplies) === current.usedIn.autoReplies
    && Number(value.usedIn?.savedSearches) === current.usedIn.savedSearches
    && Number(value.usedIn?.automations) === current.usedIn.automations;
}

export async function supportMarkAccess(c: Context<Env>): Promise<SupportMarkScope | Response> {
  const lineAccountId = c.req.query('lineAccountId');
  if (!lineAccountId) {
    return inputError(c, { success: false, error: 'LINE公式アカウントを選んでください' }, 400, ["lineAccountId"]);
  }
  const staff = c.get('staff');
  if (!staff.tenantId) {
    return c.json({ success: false, error: '所属を確認できません' }, 403);
  }
  const accountScope = await getVisibleLineAccountScope(c.env.DB, staff);
  if (!accountScope.allowedAccountIds.includes(lineAccountId)) {
    // 権限の有無からアカウントの存在を推測させない。
    return c.json({ success: false, error: '対応マークが見つかりません' }, 404);
  }
  return { tenantId: staff.tenantId, lineAccountId };
}

export function serializeSearch(
  row: SavedSearch,
  insight: SavedSearchMatchInsight = { matchCount: null, matchCountError: null },
  references: SavedSearchReference[] = [],
  callCountThisMonth = 0,
  referenceCallCounts: ReadonlyMap<string, number> = new Map(),
) {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    conditionFormat: row.condition_format ?? 'search_v1',
    conditions: JSON.parse(row.conditions_json) as unknown,
    createdBy: row.created_by,
    lineAccountId: row.line_account_id,
    isShared: Boolean(row.is_shared),
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedBy: row.updated_by ?? row.created_by,
    updatedAt: row.updated_at ?? row.created_at,
    revision: Number(row.revision ?? 1),
    matchCount: insight.matchCount,
    matchCountError: insight.matchCountError,
    callCountThisMonth,
    usedIn: references.map((reference) => ({
      kind: reference.reference_kind,
      id: reference.reference_id,
      name: reference.reference_name,
      mode: reference.reference_mode,
      revision: reference.revision,
      lastUsedAt: reference.last_used_at,
      callCountThisMonth: referenceCallCounts.get(
        `${reference.saved_search_id}:${reference.reference_kind}:${reference.reference_id}`,
      ) ?? 0,
    })),
    canDelete: references.length === 0,
  };
}

export async function savedSearchAccess(
  c: Context<Env>,
  requestedLineAccountId?: string,
): Promise<SavedSearchAccess | Response> {
  const lineAccountId = requestedLineAccountId ?? c.req.query('lineAccountId');
  if (!lineAccountId) {
    return inputError(c, { success: false, error: 'LINE公式アカウントを選んでください' }, 400, ["lineAccountId"]);
  }
  const accountScope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!accountScope.allowedAccountIds.includes(lineAccountId)) {
    return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
  }
  const staff = c.get('staff');
  return {
    lineAccountId,
    staffId: staff.id,
    canManageAll: staff.role === 'owner' || staff.role === 'admin',
  } satisfies SavedSearchAccess;
}

export function canReadSavedSearch(row: SavedSearch, access: SavedSearchAccess): boolean {
  return row.scope === 'friends'
    && (row.condition_format ?? 'search_v1') === 'search_v1'
    && row.line_account_id === access.lineAccountId
    && (access.canManageAll || Boolean(row.is_shared) || row.created_by === access.staffId);
}

export function savedSearchReferenceMap(references: SavedSearchReference[]) {
  const bySearch = new Map<string, SavedSearchReference[]>();
  for (const reference of references) {
    const current = bySearch.get(reference.saved_search_id) ?? [];
    current.push(reference);
    bySearch.set(reference.saved_search_id, current);
  }
  return bySearch;
}

export function savedSearchDetail(
  row: SavedSearch,
  match: SavedSearchMatchPreview,
  references: SavedSearchReference[],
  callCountThisMonth: number,
  referenceCallCounts: ReadonlyMap<string, number>,
  access: SavedSearchAccess,
) {
  const serialized = serializeSearch(
    row,
    { matchCount: match.total, matchCountError: match.error },
    references,
    callCountThisMonth,
    referenceCallCounts,
  );
  return {
    ...serialized,
    accountScope: { type: 'line_account' as const, id: access.lineAccountId },
    owner: {
      id: row.created_by,
      isCurrentUser: row.created_by === access.staffId,
    },
    match,
  };
}

export function positiveInteger(raw: string | undefined, fallback: number, max: number): number | null {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= max ? value : null;
}

export function nonNegativeInteger(raw: string | undefined, fallback = 0): number | null {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export async function savedSearchMatchForRow(
  db: D1Database,
  row: SavedSearch,
  lineAccountId: string,
): Promise<SavedSearchMatchPreview> {
  let raw: unknown;
  try {
    raw = JSON.parse(row.conditions_json);
  } catch {
    return {
      total: null,
      byChannel: { line: null, mail: null },
      calculatedAt: jstNow(),
      error: '条件のJSONが壊れています',
    };
  }
  const conditions = validateSearchConditions(raw);
  if (!conditions.ok) {
    return {
      total: null,
      byChannel: { line: null, mail: null },
      calculatedAt: jstNow(),
      error: conditions.error,
    };
  }
  return getSavedSearchMatchPreview(db, conditions.value, lineAccountId);
}

export const MANAGED_CONDITION_FORMATS = ['search_v1', 'segment_v1'] as const;

export /** 同じfriends向けでも、旧検索と配信対象のJSON形式を明示して分ける。 */
function requestedConditionFormat(c: Context<Env>): SavedSearchConditionFormat | Response {
  const raw = c.req.query('format') ?? 'search_v1';
  if (!(MANAGED_CONDITION_FORMATS as readonly string[]).includes(raw)) {
    return inputError(c, { success: false, error: '保存した条件の形式が正しくありません' }, 400, ["format"]);
  }
  return raw as SavedSearchConditionFormat;
}

export type StoredSavedConditions = Parameters<typeof createSavedSearch>[1]['conditions'];

export /** 保存と実送信で同じ評価器を通し、読めない条件をDBへ入れない。 */
function validateConditionsForFormat(
  format: SavedSearchConditionFormat,
  raw: unknown,
): { ok: true; value: StoredSavedConditions } | { ok: false; error: string } {
  if (format === 'search_v1') return validateSearchConditions(raw);
  const parsed = validateSavedSegmentConditions(raw);
  if (!parsed.ok) return parsed;
  try {
    buildSegmentWhere(parsed.value.condition as SegmentCondition);
  } catch {
    return { ok: false, error: '保存した対象条件を確認してください' };
  }
  return parsed;
}

export function serializeFolder(row: Folder, count?: number, itemCount?: number) {
  return {
    id: row.id,
    kind: row.kind,
    accountId: row.account_id ?? null,
    name: row.name,
    parentId: row.parent_id,
    displayOrder: row.display_order,
    revision: row.revision,
    color: row.color ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(count === undefined ? {} : { count }),
    // #631: 一覧画面が読む正式なフィールド。undefinedなら「数えていない」
    // という意味で、レスポンスからキーごと落とす（0件と区別するため）。
    ...(itemCount === undefined ? {} : { itemCount }),
  };
}

export /** 色は #RRGGBB だけ許す。名前付きの色を混ぜると、画面での見た目が揃わない。 */
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export /**
 * 対応マーク名の長さ上限（D030）。
 *
 * 情報欄の選択肢ラベルと同じ100文字。一覧・詳細・配信設定での表示崩れと、
 * DB容量の無制限消費を防ぐ。作成（POST）と編集（PATCH）で同じ値を使う。
 */
const SUPPORT_MARK_NAME_MAX = 100;

export function supportMarkRuleInput(body: Record<string, unknown>): SaveSupportMarkAutomationRule | null {
  const event = body.event;
  const priority = Number(body.priority ?? 0);
  const manualProtectionMinutes = Number(body.manualProtectionMinutes ?? 0);
  if (typeof body.name !== 'string'
    || !SUPPORT_MARK_RULE_EVENTS.includes(event as SupportMarkRuleEvent)
    || !Number.isInteger(priority)
    || !Number.isInteger(manualProtectionMinutes)) return null;
  return {
    name: body.name,
    event: event as SupportMarkRuleEvent,
    condition: body.condition === null || body.condition === undefined
      ? null
      : body.condition as SegmentCondition,
    priority,
    manualProtectionMinutes,
    isActive: body.isActive !== false,
  };
}

export /**
 * IPの末尾を伏せる。
 *
 * 監査で見たいのは「いつもと違うところから入っていないか」で、
 * 完全な値は要らない。画面に出す以上、出す量は少ない方がよい。
 */
function maskIp(ip: string): string {
  if (ip.includes(':')) {
    // IPv6。前半だけ残す。
    const parts = ip.split(':');
    return parts.slice(0, 3).join(':') + ':***';
  }
  const parts = ip.split('.');
  if (parts.length !== 4) return '***';
  return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
}

export async function folderBoundary(c: Context<Env>, folder: { account_id: string | null; kind: string }, requested?: string): Promise<Response | null> {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const owner = folder.account_id ?? null;
  if (owner ? !scope.allowedAccountIds.includes(owner) || Boolean(requested && requested !== owner)
    : !scope.canSeeUnassigned) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  return null;
}
