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
});
