import { describe, expect, it } from 'vitest';
import { formatYen, yenPercent } from './yen.js';

describe('請求と同じ円の計算・表示', () => {
  it.each([[1001, 33, 330], [1001, 50, 500], [1001, 100, 1001], [0, 50, 0]])(
    '%i円の%i%%は%i円', (price, percent, expected) => {
      expect(yenPercent(price, percent)).toBe(expected);
      expect(formatYen(price * percent / 100)).toBe(formatYen(expected));
    });
  it('無効値と0円を区別し、整数・負の調整額を表示する', () => {
    expect(formatYen(12400.99)).toBe('¥12,400');
    expect(formatYen(-12400)).toBe('¥-12,400');
    expect(formatYen(0)).toBe('¥0');
    for (const value of [null, undefined, NaN, Infinity, -Infinity]) expect(formatYen(value)).toBe('—');
    expect(formatYen(null, '未取得')).toBe('未取得');
  });
});
