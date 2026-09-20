/*
 * 保存した検索（search_v1）で実行できる条件と比較方法の一覧。
 *
 * ここが3か所の約束事を一本化する場所:
 *   - 画面の条件編集（apps/web/src/app/tags/searches/edit/page.tsx）
 *   - 保存時の形式検証（packages/db/src/saved-searches.ts）
 *   - 実行時のSQL変換（apps/worker/src/services/saved-search-filter.ts）
 *
 * 検証が通るのに実行で断られる（あるいはその逆）組み合わせがあると、
 * 保存した側が画面を離れたあと初めて検索が壊れる。ここに無い op は
 * 保存の時点で理由を付けて断る。
 */
import type { SavedSearchConditionKind } from './types';

/**
 * kind ごとに実行側が解釈できる op。
 *
 * 「存在確認」系（予約・回答・購入など）は EXISTS/NOT EXISTS だけを持つ。
 * 画面では exists/not_exists が主表記で、has/eq/not_has/ne は保存済みの
 * 旧形式をそのまま動かすための互換名。増やすときは実行側へ先に実装する。
 */
const EXISTENCE_OPS = ['exists', 'has', 'eq', 'not_exists', 'not_has', 'ne'] as const;
const DATE_RANGE_OPS = ['between', 'after', 'before'] as const;

/**
 * 友だち情報欄の値に使える比較方法（10演算子）。
 * eq/equals・ne/not_equals は同じ意味の表記違いで、実行側は両方を受ける。
 */
export const SAVED_SEARCH_FIELD_OPS = [
  'eq',
  'equals',
  'ne',
  'not_equals',
  'contains',
  'not_contains',
  'exists',
  'not_exists',
  'gte',
  'gt',
  'lte',
  'lt',
] as const;

export const SAVED_SEARCH_CONDITION_OPS: Record<SavedSearchConditionKind, readonly string[]> = {
  name: ['eq', 'contains'],
  tag: ['has', 'includes', 'eq', 'not_has', 'excludes', 'ne'],
  field: SAVED_SEARCH_FIELD_OPS,
  form: EXISTENCE_OPS,
  purchase: EXISTENCE_OPS,
  mark: ['eq'],
  assignee: ['eq', 'ne'],
  scenario: ['eq'],
  event_booking: EXISTENCE_OPS,
  calendar_booking: EXISTENCE_OPS,
  chat_status: ['eq'],
  last_activity: DATE_RANGE_OPS,
  reminder: EXISTENCE_OPS,
  memo: ['exists', 'not_exists', 'eq', 'contains'],
  following: ['eq'],
  status_message: ['eq', 'contains'],
  created_at: DATE_RANGE_OPS,
  common_event: EXISTENCE_OPS,
};

/**
 * その条件が実行できる組み合わせか。
 * 知らない kind ・ kind に合わない op は false。保存前の検証と
 * 編集画面の警告の両方がこれを使う。
 */
export function isSavedSearchOpAllowed(kind: string, op: string): boolean {
  const allowed = SAVED_SEARCH_CONDITION_OPS[kind as SavedSearchConditionKind];
  return Array.isArray(allowed) && allowed.includes(op);
}

/**
 * 「登録あり／なし」は値を持たない。値の入力を要求すると
 * 空欄判定で保存できなくなるため、kind とは別に判定する。
 */
export function isSavedSearchValueOptionalOp(op: string): boolean {
  return op === 'exists' || op === 'not_exists' || op === 'has' || op === 'not_has';
}
