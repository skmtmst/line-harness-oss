import { describe, expect, it } from 'vitest';
import { DASHBOARD_COMPARISON_BETTER, DASHBOARD_COMPARISON_KEYS, kpiChangeTone } from './kpi-comparison';

describe('kpiChangeTone（差の札の色）', () => {
  it('予約（増えると良い）が 10 → 12 なら良い', () => {
    expect(kpiChangeTone(DASHBOARD_COMPARISON_BETTER.todayBookings, 12 - 10)).toBe('good');
  });

  it('友だち（増えると良い）が減ると悪い', () => {
    expect(kpiChangeTone(DASHBOARD_COMPARISON_BETTER.activeFriends, -3)).toBe('bad');
  });

  it('配信の失敗（減ると良い）が減ると良い・増えると悪い', () => {
    expect(kpiChangeTone(DASHBOARD_COMPARISON_BETTER.deliveryFailures, -2)).toBe('good');
    expect(kpiChangeTone(DASHBOARD_COMPARISON_BETTER.deliveryFailures, 2)).toBe('bad');
  });

  it('差 0 は向きに関わらず flat', () => {
    expect(kpiChangeTone('high', 0)).toBe('flat');
    expect(kpiChangeTone('low', 0)).toBe('flat');
    expect(kpiChangeTone('neutral', 0)).toBe('flat');
  });

  it('どちらでもない数は増えても減っても良し悪しを付けない', () => {
    expect(kpiChangeTone(DASHBOARD_COMPARISON_BETTER.monthlySent, 5)).toBe('neutral');
    expect(kpiChangeTone(DASHBOARD_COMPARISON_BETTER.monthlyBroadcasts, -5)).toBe('neutral');
  });
});

describe('DASHBOARD_COMPARISON_KEYS', () => {
  it('受信・写真審査は比べない（その時点の残りを記録していない）', () => {
    const keys: readonly string[] = DASHBOARD_COMPARISON_KEYS;
    expect(keys.some((key) => /inbox|photo/i.test(key))).toBe(false);
  });

  it('全部の数に向きがある', () => {
    expect(Object.keys(DASHBOARD_COMPARISON_BETTER).sort()).toEqual([...DASHBOARD_COMPARISON_KEYS].sort());
  });
});
