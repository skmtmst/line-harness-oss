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
  revision?: number;
  updated_by?: string | null;
  updated_at?: string | null;
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
  revision?: number | null;
  last_used_at: string | null;
  created_at: string;
}

export interface SavedSearchUsageCount {
  saved_search_id: string;
  call_count_this_month: number;
}

export interface SavedSearchReferenceUsageCount extends SavedSearchUsageCount {
  reference_kind: string;
  reference_id: string | null;
}

export const INBOX_SAVED_VIEW_STATUSES = ['unread', 'in_progress', 'on_hold', 'resolved'] as const;
export const INBOX_SAVED_VIEW_CHANNELS = ['line', 'email'] as const;
export const INBOX_SAVED_VIEW_SORTS = ['newest', 'waiting_desc'] as const;
export const INBOX_SAVED_VIEW_DUE = ['all', 'overdue'] as const;

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
  due: (typeof INBOX_SAVED_VIEW_DUE)[number];
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
  const due = input.due === undefined ? 'all' : input.due;
  if (!(INBOX_SAVED_VIEW_DUE as readonly unknown[]).includes(due)) {
    return { ok: false, error: '期限条件が正しくありません' };
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
      due: due as InboxSavedViewConditions['due'],
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
              reference_name, reference_mode, revision, last_used_at, created_at
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
    revision?: number | null;
    lastUsedAt?: string | null;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO saved_search_references
       (saved_search_id, line_account_id, reference_kind, reference_id,
        reference_name, reference_mode, revision, last_used_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(saved_search_id, reference_kind, reference_id) DO UPDATE SET
       line_account_id = excluded.line_account_id,
       reference_name = excluded.reference_name,
       reference_mode = excluded.reference_mode,
       revision = excluded.revision,
       last_used_at = excluded.last_used_at`,
  ).bind(
    input.savedSearchId,
    input.lineAccountId,
    input.kind,
    input.referenceId,
    input.referenceName,
    input.mode,
    input.revision ?? null,
    input.lastUsedAt ?? null,
    jstNow(),
  ).run();
}

function savedSearchMonth(now = jstNow()): string {
  return now.slice(0, 7);
}

/** 一覧の「今月の呼び出し」を検索ごとにまとめて返す。 */
export async function getSavedSearchUsageCounts(
  db: D1Database,
  savedSearchIds: string[],
  lineAccountId: string,
  now = jstNow(),
): Promise<Map<string, number>> {
  const ids = [...new Set(savedSearchIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.prepare(
    `SELECT saved_search_id, COUNT(*) AS call_count_this_month
       FROM saved_search_usage_events
      WHERE line_account_id = ?
        AND saved_search_id IN (${placeholders})
        AND substr(used_at, 1, 7) = ?
      GROUP BY saved_search_id`,
  ).bind(lineAccountId, ...ids, savedSearchMonth(now)).all<SavedSearchUsageCount>();
  return new Map(result.results.map((row) => [
    row.saved_search_id,
    Number(row.call_count_this_month),
  ]));
}

/** 詳細の使用先ごとに、今月何回呼ばれたかを返す。 */
export async function getSavedSearchReferenceUsageCounts(
  db: D1Database,
  savedSearchIds: string[],
  lineAccountId: string,
  now = jstNow(),
): Promise<Map<string, number>> {
  const ids = [...new Set(savedSearchIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.prepare(
    `SELECT saved_search_id, reference_kind, reference_id,
            COUNT(*) AS call_count_this_month
       FROM saved_search_usage_events
      WHERE line_account_id = ?
        AND saved_search_id IN (${placeholders})
        AND substr(used_at, 1, 7) = ?
      GROUP BY saved_search_id, reference_kind, reference_id`,
  ).bind(lineAccountId, ...ids, savedSearchMonth(now)).all<SavedSearchReferenceUsageCount>();
  return new Map(result.results.map((row) => [
    `${row.saved_search_id}:${row.reference_kind}:${row.reference_id ?? ''}`,
    Number(row.call_count_this_month),
  ]));
}

/** 保存した検索を実際に使った時だけ追記する。 */
export async function recordSavedSearchUsage(
  db: D1Database,
  input: {
    savedSearchId: string;
    lineAccountId: string;
    revision: number;
    referenceKind: 'friends' | SavedSearchReferenceKind;
    referenceId?: string | null;
    usedBy?: string | null;
    usedAt?: string;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO saved_search_usage_events
       (id, saved_search_id, line_account_id, revision, reference_kind,
        reference_id, used_by, used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.savedSearchId,
    input.lineAccountId,
    input.revision,
    input.referenceKind,
    input.referenceId ?? null,
    input.usedBy ?? null,
    input.usedAt ?? jstNow(),
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
  const now = jstNow();
  await db.batch([
    db.prepare(
      `INSERT INTO saved_searches
         (id, name, scope, condition_format, conditions_json, created_by,
          line_account_id, is_shared, display_order, created_at, revision,
          updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
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
      now,
      input.createdBy ?? null,
      now,
    ),
    db.prepare(
      `INSERT INTO saved_search_revisions
         (saved_search_id, line_account_id, revision, name, conditions_json,
          is_shared, display_order, updated_by, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      input.lineAccountId,
      input.name,
      JSON.stringify(input.conditions),
      input.isShared === false ? 0 : 1,
      input.displayOrder ?? 0,
      input.createdBy ?? null,
      now,
    ),
  ]);
  return (await getSavedSearchById(db, id, input.lineAccountId))!;
}

export type SavedSearchRevisionUpdateResult =
  | { status: 'updated'; search: SavedSearch }
  | { status: 'not_found' }
  | { status: 'conflict'; current: SavedSearch };

/** 読み込んだrevisionと同じ時だけ更新し、変更後の版を履歴へ残す。 */
export async function updateSavedSearchWithRevision(
  db: D1Database,
  id: string,
  access: SavedSearchAccess,
  expectedRevision: number,
  input: {
    name?: string;
    conditions?: SearchConditions | InboxSavedViewConditions | SavedSegmentConditions;
    isShared?: boolean;
    displayOrder?: number;
  },
): Promise<SavedSearchRevisionUpdateResult> {
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

  const existing = await getSavedSearchById(db, id, access.lineAccountId);
  if (!existing || (existing.created_by !== access.staffId && !access.canManageAll)) {
    return { status: 'not_found' };
  }
  const currentRevision = Number(existing.revision ?? 1);
  if (currentRevision !== expectedRevision) {
    return { status: 'conflict', current: existing };
  }
  if (sets.length === 0) return { status: 'updated', search: existing };

  const now = jstNow();
  sets.push('revision = revision + 1', 'updated_by = ?', 'updated_at = ?');
  values.push(access.staffId, now, id, access.lineAccountId, access.staffId,
    access.canManageAll ? 1 : 0, expectedRevision);
  const statements = [
    db.prepare(
      `UPDATE saved_searches SET ${sets.join(', ')}
       WHERE id = ? AND line_account_id = ?
         AND (created_by = ? OR ? = 1) AND revision = ?`,
    ).bind(...values),
    db.prepare(
      `INSERT OR IGNORE INTO saved_search_revisions
         (saved_search_id, line_account_id, revision, name, conditions_json,
          is_shared, display_order, updated_by, created_at)
       SELECT id, line_account_id, revision, name, conditions_json,
              is_shared, display_order, updated_by, updated_at
         FROM saved_searches
        WHERE id = ? AND line_account_id = ? AND revision = ?`,
    ).bind(id, access.lineAccountId, expectedRevision + 1),
  ];
  const [result] = await db.batch(statements);
  if (Number(result?.meta?.changes ?? 0) === 0) {
    const current = await getSavedSearchById(db, id, access.lineAccountId);
    return current ? { status: 'conflict', current } : { status: 'not_found' };
  }
  const updated = await getSavedSearchById(db, id, access.lineAccountId);
  return updated ? { status: 'updated', search: updated } : { status: 'not_found' };
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
