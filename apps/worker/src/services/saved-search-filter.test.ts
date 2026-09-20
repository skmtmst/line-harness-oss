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

  it('予約・回答・リマインダ・購入を同じOR群へ接続する', () => {
    const result = compileSavedSearch({
      any: [
        { kind: 'event_booking', op: 'exists', value: 'event-a' },
        { kind: 'calendar_booking', op: 'exists', value: 'confirmed' },
        { kind: 'form', formId: 'form-a', op: 'exists' },
        { kind: 'reminder', op: 'exists', value: 'reminder-a' },
        { kind: 'purchase', op: 'exists' },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toContain('event_bookings');
      expect(result.value.sql).toContain('calendar_bookings');
      expect(result.value.sql).toContain('form_submissions');
      expect(result.value.sql).toContain('friend_reminders');
      expect(result.value.sql).toContain('ec_events');
      expect(result.value.sql).toContain(' OR ');
      expect(result.value.binds).toEqual(['event-a', 'confirmed', 'confirmed', 'form-a', 'reminder-a']);
    }
  });

  it('使えない演算子を黙って無視しない', () => {
    expect(compileSavedSearch({ all: [{ kind: 'purchase', op: 'gte', value: 1 }] })).toEqual({
      ok: false,
      error: '存在確認で使えない比較方法が指定されています',
    });
  });

  /*
    ATTR-13: 画面で選べる友だち情報の比較方法はすべて実行できる。
    「登録あり／なし」は値を取らず、大小比較は数値ならCASTする。
  */
  it('友だち情報の全演算子を実行できるSQLへ変換する', () => {
    const ops = [
      'eq', 'equals', 'ne', 'not_equals', 'contains', 'not_contains',
      'exists', 'not_exists', 'gte', 'gt', 'lte', 'lt',
    ];
    for (const op of ops) {
      const result = compileSavedSearch({
        all: [{ kind: 'field', key: 'pet_name', op, value: op === 'exists' || op === 'not_exists' ? undefined : 'ポチ' }],
      });
      expect(result.ok, `${op} は変換できる`).toBe(true);
    }
  });

  it('友だち情報の「登録あり／なし」は値なしで動く', () => {
    const exists = compileSavedSearch({ all: [{ kind: 'field', key: 'pet_name', op: 'exists' }] });
    expect(exists).toEqual({
      ok: true,
      value: expect.objectContaining({ binds: ['pet_name', 'pet_name'] }),
    });
    if (exists.ok) expect(exists.value.sql).toContain('IS NOT NULL');

    const notExists = compileSavedSearch({ all: [{ kind: 'field', key: 'pet_name', op: 'not_exists' }] });
    if (notExists.ok) expect(notExists.value.sql).toContain('IS NULL');
  });

  it('数値の大小比較はCASTして、日付などは文字列のまま比べる', () => {
    const numeric = compileSavedSearch({ all: [{ kind: 'field', key: 'weight', op: 'gte', value: '5' }] });
    if (numeric.ok) {
      expect(numeric.value.sql).toContain('CAST');
      expect(numeric.value.binds).toEqual(['weight', 5]);
    }
    const isoDate = compileSavedSearch({ all: [{ kind: 'field', key: 'birthday', op: 'lt', value: '2020-01-01' }] });
    if (isoDate.ok) {
      expect(isoDate.value.sql).not.toContain('CAST');
      expect(isoDate.value.binds).toEqual(['birthday', '2020-01-01']);
    }
  });

  it('表に無い友だち情報の演算子は断る', () => {
    const result = compileSavedSearch({ all: [{ kind: 'field', key: 'pet_name', op: 'includes', value: 'x' }] });
    expect(result).toEqual({ ok: false, error: '友だち情報で使えない比較方法が指定されています' });
  });
});
