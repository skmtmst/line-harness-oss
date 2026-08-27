import { jstNow } from './utils.js';

/**
 * 保存した検索。
 *
 * 絞り込みの条件をそのまま保存して、次から1クリックで開けるようにする。
 * 条件の形は AND群（all）と OR群（any）の2グループ。入れ子は作らない。
 * 入れ子を許すと画面が組み立てられなくなる。
 */

export const SAVED_SEARCH_SCOPES = ['friends', 'chats', 'bookings'] as const;
export type SavedSearchScope = (typeof SAVED_SEARCH_SCOPES)[number];

/** 保存できる上限。これを超えると一覧から探す方が遅くなる。 */
export const SAVED_SEARCH_LIMIT = 50;

export interface SavedSearch {
  id: string;
  name: string;
  scope: string;
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

/** 条件1つ。kind ごとに op と value の意味が変わる。 */
export interface SearchCondition {
  kind: 'tag' | 'field' | 'form' | 'purchase' | 'mark' | 'scenario' | 'created_at';
  key?: string;
  formId?: string;
  op: string;
  value?: unknown;
}

export interface SearchConditions {
  /** すべて満たす条件 */
  all?: SearchCondition[];
  /** どれか1つ満たせばよい条件 */
  any?: SearchCondition[];
  /** 'visible_only' | 'hidden_only' | 'all'。省略時は visible_only */
  visibility?: 'visible_only' | 'hidden_only' | 'all';
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
  'field',
  'form',
  'purchase',
  'mark',
  'scenario',
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

  return { ok: true, value: out };
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
): Promise<SavedSearch[]> {
  const result = await db
    .prepare(
      `SELECT * FROM saved_searches
       WHERE scope = ?
         AND (
           (line_account_id = ? AND (is_shared = 1 OR created_by = ? OR ? = 1))
           OR (line_account_id IS NULL AND created_by = ?)
         )
       ORDER BY display_order ASC, created_at ASC`,
    )
    .bind(
      scope,
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
  input: { scope: SavedSearchScope; createdBy: string; lineAccountId: string },
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM saved_searches
       WHERE scope = ? AND created_by = ? AND line_account_id = ?`,
    )
    .bind(input.scope, input.createdBy, input.lineAccountId)
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}

export async function createSavedSearch(
  db: D1Database,
  input: {
    name: string;
    scope?: SavedSearchScope;
    conditions: SearchConditions | InboxSavedViewConditions;
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
         (id, name, scope, conditions_json, created_by, line_account_id, is_shared, display_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.scope ?? 'friends',
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
    conditions?: SearchConditions | InboxSavedViewConditions;
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
