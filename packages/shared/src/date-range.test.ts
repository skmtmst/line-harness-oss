import { describe, expect, it } from 'vitest';
import { parseExecutionDateRange } from './date-range.js';
describe('実行期間', () => {
  it('日本時間の終日を翌日0時まで含める', () => {
    expect(parseExecutionDateRange({ from: '2026-09-30', to: '2026-09-30' })).toEqual({ from: '2026-09-30T00:00:00+09:00', until: '2026-10-01T00:00:00+09:00' });
  });
  it.each(['2026-02-30', '2026-13-01', '2026-2-01'])('実在しない日付を拒む %s', (from) => {
    expect(() => parseExecutionDateRange({ from })).toThrow();
  });
  it('逆転を拒む', () => expect(() => parseExecutionDateRange({ from: '2026-10-02', to: '2026-10-01' })).toThrow());
});
