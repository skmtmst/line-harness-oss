import { describe, expect, it } from 'vitest';
import { countdownParts, countdownText } from './countdown.js';

describe('開始までの長さ', () => {
  it.each([
    [19 * 86400 + 17 * 3600 + 18, '19日17時間'],
    [48 * 3600 + 1, '2日0時間'],
    [48 * 3600, '48時間0分'],
    [3600, '1時間0分'],
    [3599, '59分59秒'],
    [0, '0分0秒'], [-1, '0分0秒'], [NaN, '0分0秒'],
  ])('%s秒を読みやすい単位で出す', (seconds, expected) => {
    expect(countdownText(seconds)).toBe(expected);
    expect(countdownParts(seconds)).toHaveLength(2);
  });
});
