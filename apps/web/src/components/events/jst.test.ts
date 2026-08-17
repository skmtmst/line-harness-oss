import { describe, expect, it } from 'vitest';

import { formatSlotJp, jstHHMMToUtcIso, splitBand } from './jst.js';

describe('jstHHMMToUtcIso', () => {
  it('JST の日付と時刻を UTC に直す', () => {
    expect(jstHHMMToUtcIso('2026-09-05', '14:00')).toBe('2026-09-05T05:00:00.000Z');
  });

  it('9時より前は前日の UTC になる', () => {
    expect(jstHHMMToUtcIso('2026-09-05', '08:00')).toBe('2026-09-04T23:00:00.000Z');
  });
});

describe('formatSlotJp', () => {
  it('設計の書き方（9月5日(土) 14:00〜15:30）にする', () => {
    expect(formatSlotJp('2026-09-05T05:00:00.000Z', '2026-09-05T06:30:00.000Z')).toBe(
      '9月5日(土) 14:00〜15:30',
    );
  });

  it('UTC では前日でも、JST の日付で出す', () => {
    // 2026-09-05 08:00 JST = 2026-09-04 23:00Z
    expect(formatSlotJp('2026-09-04T23:00:00.000Z', '2026-09-05T00:00:00.000Z')).toBe(
      '9月5日(土) 08:00〜09:00',
    );
  });
});

describe('splitBand', () => {
  it('時間帯を1枠の長さで割る', () => {
    expect(splitBand('14:00', '17:00', 90)).toEqual([
      { start: '14:00', end: '15:30' },
      { start: '15:30', end: '17:00' },
    ]);
  });

  it('割り切れない端は作らない。半端な枠を公開しないため', () => {
    expect(splitBand('14:00', '17:00', 120)).toEqual([{ start: '14:00', end: '16:00' }]);
  });

  it('長さが時間帯より長ければ0件。呼び出し側がここで止める', () => {
    expect(splitBand('14:00', '15:00', 90)).toEqual([]);
  });

  it('長さが0以下なら0件。無限ループにしない', () => {
    expect(splitBand('14:00', '17:00', 0)).toEqual([]);
  });
});
