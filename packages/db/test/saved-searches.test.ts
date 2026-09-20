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
});
