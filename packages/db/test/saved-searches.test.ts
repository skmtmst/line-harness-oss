import { describe, expect, it } from 'vitest';
import { validateSearchConditions } from '../src/saved-searches.js';

describe('validateSearchConditions', () => {
  it('編集画面の説明と一覧設定を条件と一緒に保持する', () => {
    expect(validateSearchConditions({
      all: [{ kind: 'name', op: 'contains', value: 'VIP' }],
      any: [],
      visibility: 'visible_only',
      description: ' 未契約の人への案内用 ',
      list: { columns: ['名前', 'タグ'], sort: 'recent', limit: 20 },
    })).toEqual({
      ok: true,
      value: {
        all: [{ kind: 'name', op: 'contains', value: 'VIP' }],
        any: [],
        visibility: 'visible_only',
        description: '未契約の人への案内用',
        list: { columns: ['名前', 'タグ'], sort: 'recent', limit: 20 },
      },
    });
  });

  it('知らない表示件数を保存しない', () => {
    const result = validateSearchConditions({
      all: [{ kind: 'tag', op: 'includes', value: 'vip' }],
      list: { limit: 999 },
    });
    expect(result).toEqual({ ok: false, error: '表示件数が正しくありません' });
  });

  it('対象だけの条件も受け取る（#1010 FRIEND-01）', () => {
    // 「非表示のみ」はそれだけで意味のある絞り込み。all/any が空でも弾かない。
    expect(validateSearchConditions({ all: [], any: [], visibility: 'hidden_only' })).toEqual({
      ok: true,
      value: { all: [], any: [], visibility: 'hidden_only' },
    });
    expect(validateSearchConditions({ visibility: 'visible_only' })).toEqual({
      ok: true,
      value: { visibility: 'visible_only' },
    });
  });

  it('条件も対象も無い入力はこれまで通り弾く', () => {
    // 'all'（すべて）は絞り込み無しと同じなので、それだけでは受け取らない。
    expect(validateSearchConditions({ all: [], any: [] })).toEqual({
      ok: false,
      error: '条件が1つもありません',
    });
    expect(validateSearchConditions({ all: [], any: [], visibility: 'all' })).toEqual({
      ok: false,
      error: '条件が1つもありません',
    });
  });
  /*
    ATTR-13: 実行側が解釈できない op は保存の時点で断る。
    以前は「op が空でない」だけを見ていたため、保存は通るのに
    検索実行で拒否される条件が作れた。
  */
  it('その条件の種類で使えない比較方法は保存しない', () => {
    const cases: Array<[string, string]> = [
      ['name', 'gte'],          // 名前に大小比較は無い
      ['mark', 'contains'],     // 対応マークは完全一致だけ
      ['chat_status', 'ne'],    // 対応状態は一致だけ
      ['following', 'contains'],// 友だち状態は真偽
      ['field', 'includes'],    // 友だち情報に includes は無い
      ['created_at', 'eq'],     // 日付は範囲指定だけ
      ['memo', 'gte'],          // メモに大小比較は無い
    ];
    for (const [kind, op] of cases) {
      const result = validateSearchConditions({
        all: [{ kind, op, value: 'x' }],
      });
      expect(result.ok, `${kind}+${op} は拒否される`).toBe(false);
    }
  });

  it('実行側と同じ演算子表に載る組み合わせは通す', () => {
    const cases: Array<Record<string, unknown>> = [
      { kind: 'name', op: 'eq', value: '佐藤' },
      { kind: 'name', op: 'contains', value: '佐藤' },
      { kind: 'tag', op: 'includes', value: 'tag-1' },
      { kind: 'tag', op: 'excludes', value: 'tag-1' },
      { kind: 'field', op: 'eq', key: 'pet_name', value: 'ポチ' },
      { kind: 'field', op: 'not_contains', key: 'pet_name', value: 'ポチ' },
      { kind: 'field', op: 'gte', key: 'weight', value: '5' },
      { kind: 'field', op: 'exists', key: 'pet_name' },
      { kind: 'field', op: 'not_exists', key: 'pet_name' },
      { kind: 'mark', op: 'eq', value: 'mark-1' },
      { kind: 'assignee', op: 'ne', value: 'staff-1' },
      { kind: 'created_at', op: 'between', value: { from: '2026-01-01' } },
      { kind: 'memo', op: 'exists' },
      { kind: 'form', op: 'exists', formId: 'form-1' },
      { kind: 'purchase', op: 'not_has' },
    ];
    for (const condition of cases) {
      const result = validateSearchConditions({ all: [condition] });
      expect(result.ok, `${condition.kind}+${condition.op} は通る`).toBe(true);
    }
  });
});
