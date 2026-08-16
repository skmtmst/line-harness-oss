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
  is_shared: number;
  display_order: number;
  created_at: string;
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

export async function getSavedSearches(
  db: D1Database,
  scope?: SavedSearchScope,
): Promise<SavedSearch[]> {
  if (scope) {
    const result = await db
      .prepare(
        `SELECT * FROM saved_searches WHERE scope = ? ORDER BY display_order ASC, created_at ASC`,
      )
      .bind(scope)
      .all<SavedSearch>();
    return result.results;
  }
  const result = await db
    .prepare(`SELECT * FROM saved_searches ORDER BY scope ASC, display_order ASC, created_at ASC`)
    .all<SavedSearch>();
  return result.results;
}

export async function getSavedSearchById(
  db: D1Database,
  id: string,
): Promise<SavedSearch | null> {
  return db.prepare(`SELECT * FROM saved_searches WHERE id = ?`).bind(id).first<SavedSearch>();
}

export async function countSavedSearches(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS c FROM saved_searches`).first<{ c: number }>();
  return Number(row?.c ?? 0);
}

export async function createSavedSearch(
  db: D1Database,
  input: {
    name: string;
    scope?: SavedSearchScope;
    conditions: SearchConditions;
    createdBy?: string | null;
    isShared?: boolean;
    displayOrder?: number;
  },
): Promise<SavedSearch> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO saved_searches
         (id, name, scope, conditions_json, created_by, is_shared, display_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.scope ?? 'friends',
      JSON.stringify(input.conditions),
      input.createdBy ?? null,
      input.isShared === false ? 0 : 1,
      input.displayOrder ?? 0,
      jstNow(),
    )
    .run();
  return (await getSavedSearchById(db, id))!;
}

export async function updateSavedSearch(
  db: D1Database,
  id: string,
  input: {
    name?: string;
    conditions?: SearchConditions;
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
    values.push(id);
    await db
      .prepare(`UPDATE saved_searches SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }
  return getSavedSearchById(db, id);
}

export async function deleteSavedSearch(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM saved_searches WHERE id = ?`).bind(id).run();
}
