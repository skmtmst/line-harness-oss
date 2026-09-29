import { describe, expect, it } from 'vitest';
import {
  SAVED_SEARCH_CONDITION_OPS,
  SAVED_SEARCH_FIELD_OPS,
  isSavedSearchOpAllowed,
  isSavedSearchValueOptionalOp,
} from './saved-search-conditions.js';
import type { SavedSearchConditionKind } from './types.js';

/*
 * ATTR-13: 画面・DB検証・Worker実行の3か所が同じ表を見るための契約。
 * kind が増えたらここで表への登録忘れを検出する。
 */
const ALL_KINDS: SavedSearchConditionKind[] = [
  'name', 'tag', 'field', 'form', 'purchase', 'mark', 'assignee',
  'scenario', 'event_booking', 'calendar_booking', 'chat_status',
  'last_activity', 'reminder', 'memo', 'following', 'status_message',
  'created_at', 'common_event',
];

describe('SAVED_SEARCH_CONDITION_OPS', () => {
  it('全ての条件種類に実行できる演算子の表がある', () => {
    expect(Object.keys(SAVED_SEARCH_CONDITION_OPS).sort()).toEqual([...ALL_KINDS].sort());
    for (const kind of ALL_KINDS) {
      expect(SAVED_SEARCH_CONDITION_OPS[kind].length, `${kind} の演算子が空`).toBeGreaterThan(0);
    }
  });

  it('表に無い組み合わせは false を返す', () => {
    expect(isSavedSearchOpAllowed('name', 'gte')).toBe(false);
    expect(isSavedSearchOpAllowed('mark', 'contains')).toBe(false);
    expect(isSavedSearchOpAllowed('field', 'includes')).toBe(false);
    expect(isSavedSearchOpAllowed('unknown-kind', 'eq')).toBe(false);
  });

  it('表にある組み合わせは true を返す', () => {
    expect(isSavedSearchOpAllowed('field', 'gte')).toBe(true);
    expect(isSavedSearchOpAllowed('field', 'not_exists')).toBe(true);
    expect(isSavedSearchOpAllowed('tag', 'excludes')).toBe(true);
    expect(isSavedSearchOpAllowed('form', 'exists')).toBe(true);
    expect(isSavedSearchOpAllowed('created_at', 'between')).toBe(true);
  });
});

describe('SAVED_SEARCH_FIELD_OPS', () => {
  it('友だち情報の条件は実行側が解釈する演算子をすべて持つ', () => {
    for (const op of ['eq', 'equals', 'ne', 'not_equals', 'contains', 'not_contains', 'exists', 'not_exists', 'gte', 'gt', 'lte', 'lt']) {
      expect(SAVED_SEARCH_FIELD_OPS).toContain(op);
    }
  });
});

describe('isSavedSearchValueOptionalOp', () => {
  it('「登録あり／なし」だけが値を取らない', () => {
    expect(isSavedSearchValueOptionalOp('exists')).toBe(true);
    expect(isSavedSearchValueOptionalOp('not_exists')).toBe(true);
    expect(isSavedSearchValueOptionalOp('has')).toBe(true);
    expect(isSavedSearchValueOptionalOp('not_has')).toBe(true);
    expect(isSavedSearchValueOptionalOp('eq')).toBe(false);
    expect(isSavedSearchValueOptionalOp('contains')).toBe(false);
  });
});
