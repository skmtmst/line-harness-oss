/*
 * 健康日記の管理画面（★V6 37-4）：記録から「気になる変化」を出す計算を固定する。
 */
import { describe, expect, it } from 'vitest';
import { lastLoggedLabel, summarizePetHealth, thirtyDaySummary, type HealthLogRow } from './nen-health-admin.js';

const today = new Date('2026-09-17T00:00:00Z');
const log = (daysAgo: number, weight: number | null, stool = 'normal', appetite = 'normal', extra: Partial<HealthLogRow> = {}): HealthLogRow => {
  const d = new Date(today.getTime() - daysAgo * 86_400_000);
  return { pet_id: 'p', logged_on: d.toISOString().slice(0, 10), weight_kg: weight, stool_status: stool, appetite, ...extra };
};

describe('summarizePetHealth', () => {
  it('最終記録・30日の件数・8週の週平均体重を出す', () => {
    const s = summarizePetHealth([log(0, 4.2), log(1, 4.2), log(8, 4.1), log(20, 4.0), log(40, 3.9)], today);
    expect(s.lastLoggedOn).toBe('2026-09-17');
    expect(s.daysSinceLast).toBe(0);
    expect(s.count30d).toBe(4);
    expect(s.weightSeries).toHaveLength(8);
    expect(s.weightSeries[7]).toBe(4.2);
    expect(s.weightSeries[6]).toBe(4.1);
    expect(s.latestWeightKg).toBe(4.2);
    expect(s.changes).toEqual([]);
  });

  it('体重が 8 週で 10% 以上減ると「気になる変化」', () => {
    const s = summarizePetHealth([log(0, 8.0), log(7, 8.4), log(14, 8.8), log(49, 9.1)], today);
    expect(s.weightChangePercent).toBe(-12.1);
    expect(s.changes.map((c) => c.key)).toEqual(['weight_drop']);
    expect(s.changes[0].label).toBe('体重 −12.1%（8週）');
    expect(s.changes[0].tone).toBe('warn');
  });

  it('便の異常（下痢・血）が 3 回続くと印。2 回では付かない', () => {
    expect(summarizePetHealth([log(0, null, 'diarrhea'), log(1, null, 'bloody'), log(2, null, 'diarrhea')], today).changes.map((c) => c.key)).toEqual(['stool_abnormal']);
    expect(summarizePetHealth([log(0, null, 'diarrhea'), log(1, null, 'diarrhea'), log(2, null, 'normal')], today).changes).toEqual([]);
    expect(summarizePetHealth([log(0, null, 'soft'), log(1, null, 'soft'), log(2, null, 'soft')], today).changes).toEqual([]);
  });

  it('食いつき不良が 3 回続くと印', () => {
    const s = summarizePetHealth([log(0, null, 'normal', 'poor'), log(3, null, 'normal', 'poor'), log(5, null, 'normal', 'poor')], today);
    expect(s.changes.map((c) => c.key)).toEqual(['appetite_poor']);
  });

  it('30 日以上 記録がないと「記録なし」（薄い印）', () => {
    const s = summarizePetHealth([log(32, 5.0)], today);
    expect(s.changes).toEqual([{ key: 'silent', label: '30日以上 記録なし', tone: 'faint' }]);
    expect(s.count30d).toBe(0);
    expect(lastLoggedLabel(s)).toBe('08/16');
  });

  it('記録が無ければ空の要約', () => {
    const s = summarizePetHealth([], today);
    expect(s.lastLoggedOn).toBeNull();
    expect(s.weightSeries.every((v) => v === null)).toBe(true);
    expect(lastLoggedLabel(s)).toBe('—');
  });

  it('最終記録の表記：今日／昨日／N日前', () => {
    expect(lastLoggedLabel(summarizePetHealth([log(0, null)], today))).toBe('今日');
    expect(lastLoggedLabel(summarizePetHealth([log(1, null)], today))).toBe('昨日');
    expect(lastLoggedLabel(summarizePetHealth([log(12, null)], today))).toBe('12日前');
  });
});

describe('thirtyDaySummary', () => {
  it('診察向けに 30 日の記録と集計を返す（古い記録は入れない）', () => {
    const s = thirtyDaySummary([
      log(0, 4.2, 'normal', 'good', { heart_rate_bpm: 120, respiratory_rate_bpm: 26, note: '散歩のあとよく水を飲んだ' }),
      log(10, 4.1, 'soft', 'normal', { heart_rate_bpm: 116 }),
      log(29, 4.0, 'normal', 'good'),
      log(31, 3.5, 'diarrhea', 'poor'),
    ], today);
    expect(s.records).toBe(3);
    expect(s.weight).toEqual({ first: 4.0, last: 4.2, min: 4.0, max: 4.2 });
    expect(s.heartRateAvg).toBe(118);
    expect(s.respiratoryRateAvg).toBe(26);
    expect(s.stool).toEqual({ normal: 2, soft: 1 });
    expect(s.appetite).toEqual({ good: 2, normal: 1 });
    expect(s.notes).toEqual([{ loggedOn: '2026-09-17', note: '散歩のあとよく水を飲んだ' }]);
    expect(s.logs[0].loggedOn).toBe('2026-09-17');
    expect(s.logs).toHaveLength(3);
  });
});
