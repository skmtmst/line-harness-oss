import { describe, it, expect } from 'vitest';
import { nextAnniversary, parseMonthDay, isSameJstDay, isLeapYear, effectiveAnniversaryMonthDay } from './anniversary';

/**
 * 誕生日は年をまたぐ。`1990-05-03` と入っている値を年ごと比べると、
 * 一度も当たらない。ここが狂うと誕生日リマインダが1通も届かない。
 *
 * `TZ=Asia/Bangkok` を付けて走らせても同じ結果になること。
 */

const jst = (text: string) => new Date(`${text}:00+09:00`);

describe('parseMonthDay', () => {
  it('日付から月日を取る', () => {
    expect(parseMonthDay('1990-05-03')).toEqual({ month: 5, day: 3 });
    expect(parseMonthDay('1990-05-03T00:00:00')).toEqual({ month: 5, day: 3 });
  });

  it('読めない値は null', () => {
    expect(parseMonthDay('')).toBeNull();
    expect(parseMonthDay('5月3日')).toBeNull();
    expect(parseMonthDay('1990-13-01')).toBeNull();
  });
});

describe('nextAnniversary', () => {
  it('生まれ年に関係なく、今年の同じ月日を返す', () => {
    // ここが年で比べると一度も当たらないところ
    expect(nextAnniversary('1990-05-03', jst('2026-04-01T10:00'), 'mar1')).toBe('2026-05-03');
  });

  it('今日が誕生日なら今日', () => {
    expect(nextAnniversary('1990-05-03', jst('2026-05-03T00:30'), 'mar1')).toBe('2026-05-03');
  });

  it('過ぎていれば来年', () => {
    expect(nextAnniversary('1990-05-03', jst('2026-05-04T10:00'), 'mar1')).toBe('2027-05-03');
  });

  it('年末に、年明けの誕生日を見る', () => {
    expect(nextAnniversary('1990-01-05', jst('2026-12-31T23:00'), 'mar1')).toBe('2027-01-05');
  });

  it('日本時間で日付が決まる（UTC だと前日になる時刻でも）', () => {
    // 2026-05-03 08:00 JST = 2026-05-02 23:00 UTC。UTC で見ると「まだ5月2日」で、
    // 今日が誕生日なのに来年扱いになってしまう。
    expect(nextAnniversary('1990-05-03', new Date('2026-05-02T23:00:00Z'), 'mar1')).toBe('2026-05-03');
  });

  describe('2月29日', () => {
    it('うるう年はどの方針でもその日', () => {
      for (const policy of ['feb28', 'mar1', 'skip'] as const) {
        expect(nextAnniversary('2000-02-29', jst('2028-01-01T10:00'), policy)).toBe('2028-02-29');
      }
    });

    it("平年・方針'mar1'は3月1日（この設定ができる前の固定動作）", () => {
      expect(nextAnniversary('2000-02-29', jst('2026-01-01T10:00'), 'mar1')).toBe('2026-03-01');
      // 当日ちょうど・当日過ぎの境目
      expect(nextAnniversary('2000-02-29', jst('2026-03-01T00:30'), 'mar1')).toBe('2026-03-01');
      expect(nextAnniversary('2000-02-29', jst('2026-03-02T10:00'), 'mar1')).toBe('2027-03-01');
    });

    it("平年・方針'feb28'は2月28日（要件の既定）", () => {
      expect(nextAnniversary('2000-02-29', jst('2026-01-01T10:00'), 'feb28')).toBe('2026-02-28');
      expect(nextAnniversary('2000-02-29', jst('2026-02-28T00:30'), 'feb28')).toBe('2026-02-28');
      expect(nextAnniversary('2000-02-29', jst('2026-03-01T10:00'), 'feb28')).toBe('2027-02-28');
    });

    it("平年・方針'skip'はその年を飛ばして次のうるう年", () => {
      expect(nextAnniversary('2000-02-29', jst('2026-01-01T10:00'), 'skip')).toBe('2028-02-29');
      // うるう年の当日以降は、次のうるう年
      expect(nextAnniversary('2000-02-29', jst('2028-03-01T10:00'), 'skip')).toBe('2032-02-29');
      // うるう年の当日は今年
      expect(nextAnniversary('2000-02-29', jst('2028-02-29T00:30'), 'skip')).toBe('2028-02-29');
    });
  });

  describe('effectiveAnniversaryMonthDay', () => {
    it('2月29日以外は毎年同じ月日', () => {
      expect(effectiveAnniversaryMonthDay(5, 3, 2026, 'feb28')).toBe('05-03');
      expect(effectiveAnniversaryMonthDay(5, 3, 2026, 'skip')).toBe('05-03');
    });

    it('2月29日はうるう年なら 02-29', () => {
      for (const policy of ['feb28', 'mar1', 'skip'] as const) {
        expect(effectiveAnniversaryMonthDay(2, 29, 2028, policy)).toBe('02-29');
      }
    });

    it('2月29日は平年なら方針どおり（送らないは null）', () => {
      expect(effectiveAnniversaryMonthDay(2, 29, 2026, 'feb28')).toBe('02-28');
      expect(effectiveAnniversaryMonthDay(2, 29, 2026, 'mar1')).toBe('03-01');
      expect(effectiveAnniversaryMonthDay(2, 29, 2026, 'skip')).toBeNull();
    });
  });

  it('読めない値は null', () => {
    expect(nextAnniversary('', jst('2026-05-03T10:00'), 'mar1')).toBeNull();
  });
});

describe('isLeapYear', () => {
  it('4年ごと。ただし100年は除き、400年は入れる', () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });
});

describe('isSameJstDay', () => {
  it('日本時間の同じ日か', () => {
    expect(isSameJstDay('2026-05-03', jst('2026-05-03T00:00'))).toBe(true);
    expect(isSameJstDay('2026-05-03', jst('2026-05-04T00:00'))).toBe(false);
  });

  it('UTC で前日になる時刻でも、日本時間で見る', () => {
    expect(isSameJstDay('2026-05-03', new Date('2026-05-02T15:30:00Z'))).toBe(true);
  });
});
