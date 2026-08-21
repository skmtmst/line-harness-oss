import { describe, it, expect } from 'vitest';
import { currentMonthRange } from './jst-range.js';

describe('集計の既定期間', () => {
  it('月の途中なら、その月の1日から翌月1日まで', () => {
    expect(currentMonthRange('2026-08-19T22:30:00.000')).toEqual({
      from: '2026-08-01T00:00:00.000',
      to: '2026-09-01T00:00:00.000',
    });
  });

  it('12月は年をまたぐ', () => {
    expect(currentMonthRange('2026-12-31T23:59:59.999')).toEqual({
      from: '2026-12-01T00:00:00.000',
      to: '2027-01-01T00:00:00.000',
    });
  });

  it('1桁の月は 0 を詰める（詰めないと文字列の大小が狂う）', () => {
    const { from, to } = currentMonthRange('2026-09-15T12:00:00.000');
    expect(from).toBe('2026-09-01T00:00:00.000');
    expect(to).toBe('2026-10-01T00:00:00.000');
    expect('2026-09-30T23:59:59.999' >= from).toBe(true);
    expect('2026-09-30T23:59:59.999' < to).toBe(true);
    // 前月の記録は入らない
    expect('2026-08-31T23:59:59.999' >= from).toBe(false);
  });

  it('月初 0:00 ちょうども、その月に入る', () => {
    const { from } = currentMonthRange('2026-08-01T00:00:00.000');
    expect('2026-08-01T00:00:00.000' >= from).toBe(true);
  });
});
