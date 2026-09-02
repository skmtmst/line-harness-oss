import { jstNow } from './utils.js';
import type {
  SavedSearchCondition as SearchCondition,
  SavedSearchConditions as SearchConditions,
  SavedSegmentCondition,
  SavedSegmentConditions,
} from '@line-crm/shared';

export type { SavedSearchCondition as SearchCondition, SavedSearchConditions as SearchConditions } from '@line-crm/shared';

/**
 * 保存した検索。
 *
 * 絞り込みの条件をそのまま保存して、次から1クリックで開けるようにする。
 * 条件の形は AND群（all）と OR群（any）の2グループ。入れ子は作らない。
 * 入れ子を許すと画面が組み立てられなくなる。
 */

export const SAVED_SEARCH_SCOPES = ['friends', 'chats', 'bookings'] as const;
export type SavedSearchScope = (typeof SAVED_SEARCH_SCOPES)[number];
export const SAVED_SEARCH_CONDITION_FORMATS = ['search_v1', 'segment_v1'] as const;
export type SavedSearchConditionFormat = (typeof SAVED_SEARCH_CONDITION_FORMATS)[number];

/** 保存できる上限。これを超えると一覧から探す方が遅くなる。 */
export const SAVED_SEARCH_LIMIT = 50;

export interface SavedSearch {
  id: string;
  name: string;
  scope: string;
  condition_format: string;
  conditions_json: string;
  created_by: string | null;
  line_account_id: string | null;
  is_shared: number;
  display_order: number;
  created_at: string;
}

export interface SavedSearchAccess {
  lineAccountId: string;
  staffId: string;
  /** owner/admin may read every search in the selected LINE account. */
  canManageAll: boolean;
}

export const SAVED_SEARCH_REFERENCE_KINDS = ['broadcast', 'automation', 'scenario', 'other'] as const;
export type SavedSearchReferenceKind = (typeof SAVED_SEARCH_REFERENCE_KINDS)[number];
export const SAVED_SEARCH_REFERENCE_MODES = ['live', 'fixed'] as const;
export type SavedSearchReferenceMode = (typeof SAVED_SEARCH_REFERENCE_MODES)[number];

/** 保存した検索をIDで参照している実データ。 */
export interface SavedSearchReference {
  saved_search_id: string;
  line_account_id: string;
  reference_kind: SavedSearchReferenceKind;
  reference_id: string;
  reference_name: string;
  reference_mode: SavedSearchReferenceMode;
  last_used_at: string | null;
  created_at: string;
}

export const INBOX_SAVED_VIEW_STATUSES = ['unread', 'in_progress', 'on_hold', 'resolved'] as const;
export const INBOX_SAVED_VIEW_CHANNELS = ['line', 'email'] as const;
export const INBOX_SAVED_VIEW_SORTS = ['newest', 'waiting_desc'] as const;

/** 受信箱専用。友だち検索の AND/OR 条件と混ぜず、版を持って移行できる形にする。 */
export interface InboxSavedViewConditions {
  version: 1;
  query: string;
  channels: Array<(typeof INBOX_SAVED_VIEW_CHANNELS)[number]>;
  statuses: Array<(typeof INBOX_SAVED_VIEW_STATUSES)[number]>;
  assignees: string[];
  unread: 'all' | 'mine';
  messageTypes: string[];
  receivedFrom: string | null;
  receivedTo: string | null;
  sort: (typeof INBOX_SAVED_VIEW_SORTS)[number];
}

const CONDITION_KINDS = new Set([
  'tag',
  'name',
  'field',
  'form',
  'purchase',
  'mark',
  'scenario',
  'chat_status',
  'following',
  'status_message',
  'created_at',
]);

/**
 * 条件の形を確かめる。
 *
 * 保存時に弾いておかないと、検索を実行した時点で初めて壊れているのが
 * 分かることになる。保存した本人はもう画面を離れている。
 */
export function validateSearchConditions(
  raw: unknown,
): { ok: true; value: SearchConditions } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: '条件の形が正しくありません' };
  }
  const obj = raw as Record<string, unknown>;
  const out: SearchConditions = {};

  for (const group of ['all', 'any'] as const) {
    if (obj[group] === undefined) continue;
    if (!Array.isArray(obj[group])) {
      return { ok: false, error: `${group} は配列で指定してください` };
    }
    const list: SearchCondition[] = [];
    for (const item of obj[group] as unknown[]) {
      if (typeof item !== 'object' || item === null) {
        return { ok: false, error: '条件の形が正しくありません' };
      }
      const c = item as Record<string, unknown>;
      if (!CONDITION_KINDS.has(String(c.kind))) {
        return { ok: false, error: `知らない条件の種類です: ${String(c.kind)}` };
      }
      if (typeof c.op !== 'string' || c.op === '') {
        return { ok: false, error: '条件に op がありません' };
      }
      list.push(c as unknown as SearchCondition);
    }
    out[group] = list;
  }

  if ((out.all?.length ?? 0) === 0 && (out.any?.length ?? 0) === 0) {
    return { ok: false, error: '条件が1つもありません' };
  }

  if (obj.visibility !== undefined) {
    if (!['visible_only', 'hidden_only', 'all'].includes(String(obj.visibility))) {
      return { ok: false, error: '表示状態の指定が正しくありません' };
    }
    out.visibility = obj.visibility as SearchConditions['visibility'];
  }

  if (obj.description !== undefined) {
    if (typeof obj.description !== 'string') {
      return { ok: false, error: '説明は文字で指定してください' };
    }
    out.description = obj.description.trim().slice(0, 300);
  }

  if (obj.list !== undefined) {
    if (typeof obj.list !== 'object' || obj.list === null || Array.isArray(obj.list)) {
      return { ok: false, error: '一覧の表示設定が正しくありません' };
    }
    const list = obj.list as Record<string, unknown>;
    const limit = list.limit === undefined ? undefined : Number(list.limit);
    if (limit !== undefined && ![10, 20, 30, 40, 50].includes(limit)) {
      return { ok: false, error: '表示件数が正しくありません' };
    }
    const sort = list.sort === undefined ? undefined : String(list.sort);
    if (sort !== undefined && sort !== 'recent' && sort !== 'oldest') {
      return { ok: false, error: '並び順が正しくありません' };
    }
    const columns = list.columns === undefined ? undefined : stringArray(list.columns);
    if (list.columns !== undefined && !columns) {
      return { ok: false, error: '表示列が正しくありません' };
    }
    out.list = {
      ...(columns ? { columns } : {}),
      ...(sort ? { sort: sort as 'recent' | 'oldest' } : {}),
      ...(limit ? { limit: limit as 10 | 20 | 30 | 40 | 50 } : {}),
    };
  }

  return { ok: true, value: out };
}

const SEGMENT_RULE_TYPES = new Set([
  'tag_exists',
  'tag_not_exists',
  'tag_all',
  'tag_not_all',
  'metadata_equals',
  'metadata_not_equals',
  'ref_code',
  'is_following',
  'scenario_subscribed',
  'name',
  'private_memo',
  'status_message',
  'registered_at',
  'support_mark',
  'is_hidden',
  'friend_field',
  'scenario_state',
  'form_answered',
  'last_reaction_at',
  'reaction_state',
  'score_range',
]);

/** 画面で扱う上限。深い論理式や巨大なJSONを保存させない。 */
const SEGMENT_MAX_DEPTH = 2;
const SEGMENT_MAX_RULES = 50;

function validateSegmentNode(
  raw: unknown,
  depth: number,
  counter: { rules: number },
): SavedSegmentCondition | null {
  if (depth > SEGMENT_MAX_DEPTH || typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const input = raw as Record<string, unknown>;
  if (input.operator !== 'AND' && input.operator !== 'OR') return null;
  if (!Array.isArray(input.rules)) return null;
  const rules: SavedSegmentCondition['rules'] = [];
  for (const rawRule of input.rules) {
    if (typeof rawRule !== 'object' || rawRule === null || Array.isArray(rawRule)) return null;
    const rule = rawRule as Record<string, unknown>;
    if (!SEGMENT_RULE_TYPES.has(String(rule.type))
        || !Object.prototype.hasOwnProperty.call(rule, 'value')) return null;
    counter.rules += 1;
    if (counter.rules > SEGMENT_MAX_RULES) return null;
    rules.push({ type: rule.type, value: rule.value } as SavedSegmentCondition['rules'][number]);
  }
  if (input.groups !== undefined && !Array.isArray(input.groups)) return null;
  const groups: SavedSegmentCondition[] = [];
  for (const rawGroup of input.groups ?? []) {
    const group = validateSegmentNode(rawGroup, depth + 1, counter);
    if (!group) return null;
    groups.push(group);
  }
  return { operator: input.operator, rules, groups };
}

/**
 * 保存する共通配信対象条件を、版・深さ・件数まで検査する。
 * 値の意味はWorkerの同じ評価器でも検査し、画面と送信で判断を分けない。
 */
export function validateSavedSegmentConditions(
  raw: unknown,
): { ok: true; value: SavedSegmentConditions } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: '保存した対象条件の形が正しくありません' };
  }
  const input = raw as Record<string, unknown>;
  if (input.version !== 1) return { ok: false, error: '対応していない対象条件の版です' };
  const counter = { rules: 0 };
  const condition = validateSegmentNode(input.condition, 0, counter);
  if (!condition) return { ok: false, error: '保存した対象条件の形が正しくありません' };
  if (counter.rules === 0) return { ok: false, error: '対象条件が1つもありません' };
  return { ok: true, value: { version: 1, condition } };
}

function stringArray(value: unknown, allowed?: readonly string[]): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  const result = [...new Set(value as string[])];
  if (allowed && result.some((item) => !allowed.includes(item))) return null;
  return result;
}

export function validateInboxSavedViewConditions(
  raw: unknown,
): { ok: true; value: InboxSavedViewConditions } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: '受信箱の条件の形が正しくありません' };
  }
  const input = raw as Record<string, unknown>;
  if (input.version !== 1) return { ok: false, error: '対応していない条件の版です' };
  const channels = stringArray(input.channels, INBOX_SAVED_VIEW_CHANNELS);
  const statuses = stringArray(input.statuses, INBOX_SAVED_VIEW_STATUSES);
  const assignees = stringArray(input.assignees);
  const messageTypes = stringArray(input.messageTypes);
  if (!channels?.length) return { ok: false, error: '表示する連絡手段を選んでください' };
  if (!statuses?.length) return { ok: false, error: '表示する対応状態を選んでください' };
  if (!assignees || !messageTypes) return { ok: false, error: '絞り込み条件が正しくありません' };
  if (input.unread !== 'all' && input.unread !== 'mine') {
    return { ok: false, error: '未読条件が正しくありません' };
  }
  if (!(INBOX_SAVED_VIEW_SORTS as readonly unknown[]).includes(input.sort)) {
    return { ok: false, error: '並び順が正しくありません' };
  }
  const query = typeof input.query === 'string' ? input.query.trim().slice(0, 200) : '';
  const receivedFrom = input.receivedFrom === null || typeof input.receivedFrom === 'string'
    ? input.receivedFrom as string | null
    : null;
  const receivedTo = input.receivedTo === null || typeof input.receivedTo === 'string'
    ? input.receivedTo as string | null
    : null;
  return {
    ok: true,
    value: {
      version: 1,
      query,
      channels: channels as InboxSavedViewConditions['channels'],
      statuses: statuses as InboxSavedViewConditions['statuses'],
      assignees,
      unread: input.unread,
      messageTypes,
      receivedFrom,
      receivedTo,
      sort: input.sort as InboxSavedViewConditions['sort'],
    },
  };
}

export async function getSavedSearches(
  db: D1Database,
  scope: SavedSearchScope,
  access: SavedSearchAccess,
  conditionFormat: SavedSearchConditionFormat = 'search_v1',
): Promise<SavedSearch[]> {
  const result = await db
    .prepare(
      `SELECT * FROM saved_searches
       WHERE scope = ? AND condition_format = ?
         AND (
           (line_account_id = ? AND (is_shared = 1 OR created_by = ? OR ? = 1))
           OR (line_account_id IS NULL AND created_by = ?)
         )
       ORDER BY display_order ASC, created_at ASC`,
    )
    .bind(
      scope,
      conditionFormat,
      access.lineAccountId,
      access.staffId,
      access.canManageAll ? 1 : 0,
      access.staffId,
    )
    .all<SavedSearch>();
  return result.results;
}

export async function getSavedSearchById(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<SavedSearch | null> {
  return db
    .prepare(`SELECT * FROM saved_searches WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId)
    .first<SavedSearch>();
}

export async function countSavedSearches(
  db: D1Database,
  input: {
    scope: SavedSearchScope;
    conditionFormat?: SavedSearchConditionFormat;
    createdBy: string;
    lineAccountId: string;
  },
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM saved_searches
       WHERE scope = ? AND condition_format = ? AND created_by = ? AND line_account_id = ?`,
    )
    .bind(input.scope, input.conditionFormat ?? 'search_v1', input.createdBy, input.lineAccountId)
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}

/**
 * 保存検索の使用先をまとめて返す。
 *
 * 一覧で1件ずつ問い合わせると最大50回になるため、選択中アカウント内を
 * 1回で読む。IDだけでなくline_account_idも絞り、別アカウントの利用先を
 * 混ぜない。
 */
export async function getSavedSearchReferences(
  db: D1Database,
  savedSearchIds: string[],
  lineAccountId: string,
): Promise<SavedSearchReference[]> {
  const ids = [...new Set(savedSearchIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db
    .prepare(
      `SELECT saved_search_id, line_account_id, reference_kind, reference_id,
              reference_name, reference_mode, last_used_at, created_at
         FROM saved_search_references
        WHERE line_account_id = ? AND saved_search_id IN (${placeholders})
        ORDER BY reference_kind ASC, reference_name ASC, reference_id ASC`,
    )
    .bind(lineAccountId, ...ids)
    .all<SavedSearchReference>();
  return result.results;
}

/** 利用側が保存検索を参照し始めたときに同じ台帳へ登録する。 */
export async function upsertSavedSearchReference(
  db: D1Database,
  input: {
    savedSearchId: string;
    lineAccountId: string;
    kind: SavedSearchReferenceKind;
    referenceId: string;
    referenceName: string;
    mode: SavedSearchReferenceMode;
    lastUsedAt?: string | null;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO saved_search_references
       (saved_search_id, line_account_id, reference_kind, reference_id,
        reference_name, reference_mode, last_used_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(saved_search_id, reference_kind, reference_id) DO UPDATE SET
       line_account_id = excluded.line_account_id,
       reference_name = excluded.reference_name,
       reference_mode = excluded.reference_mode,
       last_used_at = excluded.last_used_at`,
  ).bind(
    input.savedSearchId,
    input.lineAccountId,
    input.kind,
    input.referenceId,
    input.referenceName,
    input.mode,
    input.lastUsedAt ?? null,
    jstNow(),
  ).run();
}

export async function removeSavedSearchReference(
  db: D1Database,
  input: { savedSearchId: string; kind: SavedSearchReferenceKind; referenceId: string },
): Promise<void> {
  await db.prepare(
    `DELETE FROM saved_search_references
      WHERE saved_search_id = ? AND reference_kind = ? AND reference_id = ?`,
  ).bind(input.savedSearchId, input.kind, input.referenceId).run();
}

export async function createSavedSearch(
  db: D1Database,
  input: {
    name: string;
    scope?: SavedSearchScope;
    conditionFormat?: SavedSearchConditionFormat;
    conditions: SearchConditions | InboxSavedViewConditions | SavedSegmentConditions;
    createdBy?: string | null;
    lineAccountId: string;
    isShared?: boolean;
    displayOrder?: number;
  },
): Promise<SavedSearch> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO saved_searches
         (id, name, scope, condition_format, conditions_json, created_by, line_account_id, is_shared, display_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.scope ?? 'friends',
      input.conditionFormat ?? 'search_v1',
      JSON.stringify(input.conditions),
      input.createdBy ?? null,
      input.lineAccountId,
      input.isShared === false ? 0 : 1,
      input.displayOrder ?? 0,
      jstNow(),
    )
    .run();
  return (await getSavedSearchById(db, id, input.lineAccountId))!;
}

export async function updateSavedSearch(
  db: D1Database,
  id: string,
  access: SavedSearchAccess,
  input: {
    name?: string;
    conditions?: SearchConditions | InboxSavedViewConditions | SavedSegmentConditions;
    isShared?: boolean;
    displayOrder?: number;
  },
): Promise<SavedSearch | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    values.push(input.name);
  }
  if (input.conditions !== undefined) {
    sets.push('conditions_json = ?');
    values.push(JSON.stringify(input.conditions));
  }
  if (input.isShared !== undefined) {
    sets.push('is_shared = ?');
    values.push(input.isShared ? 1 : 0);
  }
  if (input.displayOrder !== undefined) {
    sets.push('display_order = ?');
    values.push(input.displayOrder);
  }
  if (sets.length > 0) {
    values.push(id, access.lineAccountId, access.staffId, access.canManageAll ? 1 : 0);
    await db
      .prepare(
        `UPDATE saved_searches SET ${sets.join(', ')}
         WHERE id = ? AND line_account_id = ? AND (created_by = ? OR ? = 1)`,
      )
      .bind(...values)
      .run();
  }
  const updated = await getSavedSearchById(db, id, access.lineAccountId);
  return updated && (updated.created_by === access.staffId || access.canManageAll) ? updated : null;
}

export async function deleteSavedSearch(
  db: D1Database,
  id: string,
  access: SavedSearchAccess,
): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM saved_searches
       WHERE id = ? AND line_account_id = ? AND (created_by = ? OR ? = 1)`,
    )
    .bind(id, access.lineAccountId, access.staffId, access.canManageAll ? 1 : 0)
    .run();
  return Number(result.meta.changes ?? 0) > 0;
}
