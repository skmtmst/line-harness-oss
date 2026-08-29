import { describe, expect, it } from 'vitest';
import { compileSavedSearch } from './saved-search-filter.js';

describe('compileSavedSearch', () => {
  it('AND群とOR群を別々に括って結ぶ', () => {
    const result = compileSavedSearch({
      all: [{ kind: 'tag', op: 'includes', value: 'vip' }],
      any: [
        { kind: 'name', op: 'contains', value: '田中' },
        { kind: 'field', key: 'plan', op: 'eq', value: '未契約' },
      ],
      visibility: 'visible_only',
    });
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ binds: ['vip', '%田中%', 'plan', '未契約'] }),
    });
    if (result.ok) {
      expect(result.value.sql).toContain(' AND ');
      expect(result.value.sql).toContain(' OR ');
      expect(result.value.sql).toContain('f.is_hidden = 0');
    }
  });

  it('値はSQLへ埋め込まずbindする', () => {
    const result = compileSavedSearch({ all: [{ kind: 'name', op: 'contains', value: `%') OR 1=1 --` }] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).not.toContain('1=1');
      expect(result.value.binds).toEqual([`%%') OR 1=1 --%`]);
    }
  });

  it('未接続の購入条件を黙って無視しない', () => {
    expect(compileSavedSearch({ all: [{ kind: 'purchase', op: 'gte', value: 1 }] })).toEqual({
      ok: false,
      error: '購入履歴の条件は、購入と友だちを結ぶ口が未接続です',
    });
  });
});
