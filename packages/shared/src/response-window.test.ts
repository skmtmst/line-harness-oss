import { describe, it, expect } from 'vitest';
import {
  isWithinWindow,
  toJstParts,
  parseHhMm,
  validateResponseWindow,
  ALWAYS_OPEN,
  type ResponseWindow,
} from './response-window';

/**
 * 判定は日本時間で固定する。
 *
 * このファイルは `TZ=Asia/Bangkok` を付けて走らせても同じ結果になること。
 * ローカルの getDay() や getHours() を使うと、ここで落ちる。
 */

/** 日本時間の "YYYY-MM-DDTHH:MM" を Date にする（実行環境の時計に依らない）。 */
function jst(text: string): Date {
  return new Date(`${text}:00+09:00`);
}

function windowOf(patch: Partial<ResponseWindow>): ResponseWindow {
  return { weekdays: [], holiday: 'ignore', ranges: [], ...patch };
}

describe('toJstParts', () => {
  it('UTC の深夜でも、日本時間の日付と曜日を返す', () => {
    // 2026-08-19 22:00 UTC = 2026-08-20 07:00 JST（水→木）
    const parts = toJstParts(new Date('2026-08-19T22:00:00Z'));
    expect(parts.date).toBe('2026-08-20');
    expect(parts.weekday).toBe(4); // 木
    expect(parts.minutes).toBe(7 * 60);
  });

  it('日本時間の 0:00 ちょうどは、その日の 0 分目', () => {
    const parts = toJstParts(jst('2026-08-20T00:00'));
    expect(parts.date).toBe('2026-08-20');
    expect(parts.minutes).toBe(0);
  });
});

describe('parseHhMm', () => {
  it('よくある書き方を読む', () => {
    expect(parseHhMm('9:00')).toBe(540);
    expect(parseHhMm('09:00')).toBe(540);
    expect(parseHhMm('23:59')).toBe(1439);
    expect(parseHhMm(' 18:30 ')).toBe(1110);
  });

  it('あり得ない時刻は読まない', () => {
    expect(parseHhMm('25:00')).toBeNull();
    expect(parseHhMm('12:60')).toBeNull();
    expect(parseHhMm('お昼')).toBeNull();
    expect(parseHhMm('')).toBeNull();
  });
});

describe('isWithinWindow', () => {
  it('何も絞らなければ、いつでも応答する', () => {
    expect(isWithinWindow(ALWAYS_OPEN, jst('2026-08-20T03:00'))).toBe(true);
    expect(isWithinWindow(ALWAYS_OPEN, jst('2026-01-01T12:00'))).toBe(true);
  });

  it('曜日だけの指定は、その日いっぱい', () => {
    // 2026-08-20 は木曜
    const w = windowOf({ weekdays: [4] });
    expect(isWithinWindow(w, jst('2026-08-20T00:00'))).toBe(true);
    expect(isWithinWindow(w, jst('2026-08-20T23:59'))).toBe(true);
    expect(isWithinWindow(w, jst('2026-08-21T12:00'))).toBe(false); // 金
  });

  it('時間帯の端は両方とも含む', () => {
    const w = windowOf({ ranges: [{ start: '9:00', end: '18:00' }] });
    expect(isWithinWindow(w, jst('2026-08-20T09:00'))).toBe(true);
    expect(isWithinWindow(w, jst('2026-08-20T18:00'))).toBe(true);
    expect(isWithinWindow(w, jst('2026-08-20T08:59'))).toBe(false);
    expect(isWithinWindow(w, jst('2026-08-20T18:01'))).toBe(false);
  });

  it('曜日と時間帯は「どちらも満たす」', () => {
    const w = windowOf({ weekdays: [4], ranges: [{ start: '9:00', end: '18:00' }] });
    expect(isWithinWindow(w, jst('2026-08-20T12:00'))).toBe(true); // 木の昼
    expect(isWithinWindow(w, jst('2026-08-20T20:00'))).toBe(false); // 木の夜
    expect(isWithinWindow(w, jst('2026-08-21T12:00'))).toBe(false); // 金の昼
  });

  it('帯が複数あるときは、どれかに入っていればよい', () => {
    const w = windowOf({
      ranges: [
        { start: '9:00', end: '12:00' },
        { start: '13:00', end: '18:00' },
      ],
    });
    expect(isWithinWindow(w, jst('2026-08-20T10:00'))).toBe(true);
    expect(isWithinWindow(w, jst('2026-08-20T12:30'))).toBe(false); // 昼休み
    expect(isWithinWindow(w, jst('2026-08-20T15:00'))).toBe(true);
  });

  it('帯が重なっていても弾かない（判定はどれかに入ればよい）', () => {
    const w = windowOf({
      ranges: [
        { start: '9:00', end: '12:00' },
        { start: '11:00', end: '15:00' },
      ],
    });
    expect(isWithinWindow(w, jst('2026-08-20T11:30'))).toBe(true);
  });

  describe('日をまたぐ帯', () => {
    // 2026-08-21 は金曜、2026-08-22 は土曜
    const w = windowOf({ weekdays: [5], ranges: [{ start: '22:00', end: '02:00' }] });

    it('金曜の夜は応答する', () => {
      expect(isWithinWindow(w, jst('2026-08-21T22:00'))).toBe(true);
      expect(isWithinWindow(w, jst('2026-08-21T23:30'))).toBe(true);
    });

    it('土曜の未明も「金曜の夜」として応答する', () => {
      expect(isWithinWindow(w, jst('2026-08-22T00:30'))).toBe(true);
      expect(isWithinWindow(w, jst('2026-08-22T02:00'))).toBe(true);
    });

    it('土曜の未明でも、帯を過ぎれば応答しない', () => {
      expect(isWithinWindow(w, jst('2026-08-22T02:01'))).toBe(false);
      expect(isWithinWindow(w, jst('2026-08-22T22:00'))).toBe(false); // 土曜の夜は対象外
    });

    it('金曜の昼は応答しない', () => {
      expect(isWithinWindow(w, jst('2026-08-21T12:00'))).toBe(false);
    });
  });

  describe('祝日', () => {
    // 2026-08-11 は火曜で「山の日」。2026-08-12 は水曜で平日。
    it('ignore なら祝日を見ない', () => {
      const w = windowOf({ weekdays: [2], holiday: 'ignore' });
      expect(isWithinWindow(w, jst('2026-08-11T12:00'))).toBe(true);
    });

    it('include なら、選んでいない曜日でも祝日は応答する', () => {
      const w = windowOf({ weekdays: [3], holiday: 'include' }); // 水曜だけ選択
      expect(isWithinWindow(w, jst('2026-08-11T12:00'))).toBe(true); // 火だが祝日
      expect(isWithinWindow(w, jst('2026-08-12T12:00'))).toBe(true); // 水
      expect(isWithinWindow(w, jst('2026-08-13T12:00'))).toBe(false); // 木・平日
    });

    it('exclude なら、選んだ曜日でも祝日は応答しない', () => {
      const w = windowOf({ weekdays: [2], holiday: 'exclude' }); // 火曜を選択
      expect(isWithinWindow(w, jst('2026-08-11T12:00'))).toBe(false); // 火だが祝日
      expect(isWithinWindow(w, jst('2026-08-18T12:00'))).toBe(true); // 火・平日
    });
  });

  it('読めない時刻の帯は、無いものとして飛ばす', () => {
    const w = windowOf({
      ranges: [
        { start: '25:00', end: '26:00' },
        { start: '9:00', end: '18:00' },
      ],
    });
    expect(isWithinWindow(w, jst('2026-08-20T12:00'))).toBe(true);
    expect(isWithinWindow(w, jst('2026-08-20T20:00'))).toBe(false);
  });
});

describe('validateResponseWindow', () => {
  it('正しい設定は通る', () => {
    expect(validateResponseWindow(ALWAYS_OPEN)).toBeNull();
    expect(
      validateResponseWindow(windowOf({ weekdays: [1, 2, 3], ranges: [{ start: '9:00', end: '18:00' }] })),
    ).toBeNull();
  });

  it('曜日の範囲外は断る', () => {
    expect(validateResponseWindow(windowOf({ weekdays: [7] }))).toContain('曜日');
  });

  it('読めない時刻は断る', () => {
    expect(validateResponseWindow(windowOf({ ranges: [{ start: '9時', end: '18:00' }] }))).toContain(
      '時刻',
    );
  });
});
