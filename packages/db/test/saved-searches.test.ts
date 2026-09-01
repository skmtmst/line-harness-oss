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
});
