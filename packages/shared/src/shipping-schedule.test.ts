import { describe, expect, it, vi } from 'vitest';
import {
  COVERED_YEARS,
  isJapaneseHoliday,
  isYearCovered,
  setHolidayCoverageWarningHandler,
} from './japanese-holidays';
import {
  addDays,
  calculateShipDateFromOrderedAt,
  isBusinessDay,
  isWeekend,
  nextBusinessDayAfter,
  normalizeSubscriptionShipDate,
  resolveShipDate,
  toJstMoment,
} from './shipping-schedule';

describe('祝日表', () => {
  it('対象年の祝日を判定する', () => {
    expect(isJapaneseHoliday('2026-01-01')).toBe(true);
    expect(isJapaneseHoliday('2026-05-05')).toBe(true);
    expect(isJapaneseHoliday('2026-08-14')).toBe(false);
  });

  it('対象年の範囲を返す', () => {
    expect(isYearCovered(`${COVERED_YEARS.from}-01-01`)).toBe(true);
    expect(isYearCovered(`${COVERED_YEARS.to}-12-31`)).toBe(true);
    expect(isYearCovered(`${COVERED_YEARS.to + 1}-01-01`)).toBe(false);
  });

  it('対象外の年は警告を出したうえで「祝日ではない」と答える', () => {
    const warn = vi.fn();
    setHolidayCoverageWarningHandler(warn);
    try {
      expect(isJapaneseHoliday(`${COVERED_YEARS.to + 1}-01-01`)).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][1]).toBe(`${COVERED_YEARS.to + 1}-01-01`);
    } finally {
      setHolidayCoverageWarningHandler(() => {});
    }
  });
});

describe('JST への変換', () => {
  it('オフセット付きと Z 付きで同じ結果になる', () => {
    expect(toJstMoment('2026-08-14T11:30:00+09:00')).toEqual({ date: '2026-08-14', hour: 11 });
    expect(toJstMoment('2026-08-14T02:30:00Z')).toEqual({ date: '2026-08-14', hour: 11 });
  });

  it('UTC の深夜は JST では翌日になる', () => {
    expect(toJstMoment('2026-08-13T16:00:00Z')).toEqual({ date: '2026-08-14', hour: 1 });
  });

  it('解釈できない文字列は null', () => {
    expect(toJstMoment('not-a-date')).toBeNull();
  });
});

describe('営業日の判定', () => {
  it('土日を休みとする', () => {
    expect(isWeekend('2026-08-15')).toBe(true); // 土
    expect(isWeekend('2026-08-16')).toBe(true); // 日
    expect(isWeekend('2026-08-17')).toBe(false); // 月
  });

  it('祝日を休みとする', () => {
    expect(isBusinessDay('2026-08-11')).toBe(false); // 山の日（火）
    expect(isBusinessDay('2026-08-12')).toBe(true);
  });

  it('日付の加算が月と年をまたぐ', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29'); // 閏年
  });
});

describe('出荷予定日の算出（通常注文）', () => {
  it('営業日の午前中は当日', () => {
    // 2026-08-14 は金曜
    expect(calculateShipDateFromOrderedAt('2026-08-14T09:00:00+09:00')).toBe('2026-08-14');
    expect(calculateShipDateFromOrderedAt('2026-08-14T11:59:59+09:00')).toBe('2026-08-14');
  });

  it('12:00 ちょうどは翌営業日（午後の扱い）', () => {
    expect(calculateShipDateFromOrderedAt('2026-08-14T12:00:00+09:00')).toBe('2026-08-17');
  });

  it('金曜の午後は翌週の月曜へ繰り越す', () => {
    // 土日を飛ばして 2026-08-17（月）
    expect(calculateShipDateFromOrderedAt('2026-08-14T15:00:00+09:00')).toBe('2026-08-17');
  });

  it('土曜の注文は午前でも翌営業日', () => {
    expect(calculateShipDateFromOrderedAt('2026-08-15T09:00:00+09:00')).toBe('2026-08-17');
  });

  it('祝日の注文は午前でも翌営業日', () => {
    // 2026-08-11 は山の日（火）。翌 12日（水）が営業日。
    expect(calculateShipDateFromOrderedAt('2026-08-11T09:00:00+09:00')).toBe('2026-08-12');
  });

  it('算出結果が祝日に当たる場合は次の営業日へ繰り越す', () => {
    // 2026-08-10（月）の午後 → 翌日は 11日の祝日 → 12日（水）
    expect(calculateShipDateFromOrderedAt('2026-08-10T14:00:00+09:00')).toBe('2026-08-12');
  });

  it('連休をまたぐ（ゴールデンウィーク）', () => {
    // 2026-04-28（火）午後 → 29日は昭和の日 → 30日（木）
    expect(calculateShipDateFromOrderedAt('2026-04-28T13:00:00+09:00')).toBe('2026-04-30');
    // 2026-05-01（金）午後 → 2・3日は土日/憲法記念日、4-6日も祝日 → 7日（木）
    expect(calculateShipDateFromOrderedAt('2026-05-01T13:00:00+09:00')).toBe('2026-05-07');
  });

  it('年末年始をまたぐ', () => {
    // 2025-12-31（水）午後 → 2026-01-01 は元日 → 1/2（金）
    expect(calculateShipDateFromOrderedAt('2025-12-31T13:00:00+09:00')).toBe('2026-01-02');
    // 2026-01-01（木・元日）の午前 → 2日（金）
    expect(calculateShipDateFromOrderedAt('2026-01-01T09:00:00+09:00')).toBe('2026-01-02');
    // 2026-01-02（金）午後 → 3・4日は土日 → 5日（月）
    expect(calculateShipDateFromOrderedAt('2026-01-02T13:00:00+09:00')).toBe('2026-01-05');
  });

  it('UTC 表記でも JST として扱う', () => {
    // 2026-08-14T02:00:00Z = JST 11:00（金・午前）→ 当日
    expect(calculateShipDateFromOrderedAt('2026-08-14T02:00:00Z')).toBe('2026-08-14');
    // 2026-08-14T04:00:00Z = JST 13:00（金・午後）→ 翌営業日
    expect(calculateShipDateFromOrderedAt('2026-08-14T04:00:00Z')).toBe('2026-08-17');
  });

  it('解釈できない日時は null', () => {
    expect(calculateShipDateFromOrderedAt('')).toBeNull();
    expect(calculateShipDateFromOrderedAt('昨日')).toBeNull();
  });

  it('翌営業日は必ず当日より後になる', () => {
    expect(nextBusinessDayAfter('2026-08-14')).toBe('2026-08-17');
  });
});

describe('定期便の出荷予定日', () => {
  it('EC 側の予定日をそのまま使う', () => {
    expect(normalizeSubscriptionShipDate('2026-08-31')).toBe('2026-08-31');
  });

  it('日曜でも営業日へ寄せない（EC 側の予定を尊重する）', () => {
    // 2026-08-16 は日曜だが、EC が決めた日をこちらで動かさない
    expect(resolveShipDate({ scheduledShippingDate: '2026-08-16' })).toEqual({
      date: '2026-08-16',
      source: 'subscription',
    });
  });

  it('日時つきでも暦日を取り出す', () => {
    expect(normalizeSubscriptionShipDate('2026-08-31T10:00:00+09:00')).toBe('2026-08-31');
  });

  it('空や null は予定日なし', () => {
    expect(normalizeSubscriptionShipDate(null)).toBeNull();
    expect(normalizeSubscriptionShipDate('')).toBeNull();
  });
});

describe('出荷予定日の入口', () => {
  it('定期便の予定日があればそちらを使う', () => {
    expect(
      resolveShipDate({ scheduledShippingDate: '2026-08-31', orderedAt: '2026-08-14T09:00:00+09:00' }),
    ).toEqual({ date: '2026-08-31', source: 'subscription' });
  });

  it('定期便の予定日が無ければ注文日時から算出する', () => {
    expect(resolveShipDate({ orderedAt: '2026-08-14T09:00:00+09:00' })).toEqual({
      date: '2026-08-14',
      source: 'ordered_at',
    });
  });

  it('どちらも無ければ予定日なし', () => {
    expect(resolveShipDate({})).toEqual({ date: null, source: 'ordered_at' });
  });
});
