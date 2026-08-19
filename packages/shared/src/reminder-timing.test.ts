import { describe, it, expect } from 'vitest';
import {
  resolveReminderSendAt,
  describeReminderTiming,
  usesDayTiming,
} from './reminder-timing';

/**
 * 日本時間で計算していることを確かめる。
 *
 * `TZ=Asia/Bangkok` を付けて走らせても同じ結果になること。ここが狂うと
 * 「前日の20時」が当日の20時になり、当日に「明日です」と送ることになる。
 */

/** 日本時間の "YYYY-MM-DDTHH:MM" を Date にする。 */
const jst = (text: string) => new Date(`${text}:00+09:00`);
/** Date を日本時間の "YYYY-MM-DD HH:MM" で表す（比較用）。 */
function showJst(d: Date): string {
  const shifted = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())} ` +
    `${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}`
  );
}

describe('usesDayTiming', () => {
  it('日数と時刻がそろって初めて、日付での指定として扱う', () => {
    expect(usesDayTiming({ offsetDays: -3, sendAtTime: '10:00', offsetMinutes: 0 })).toBe(true);
    expect(usesDayTiming({ offsetDays: -3, sendAtTime: null, offsetMinutes: 0 })).toBe(false);
    expect(usesDayTiming({ offsetDays: null, sendAtTime: '10:00', offsetMinutes: 0 })).toBe(false);
    expect(usesDayTiming({ offsetMinutes: -60 })).toBe(false);
  });

  it('読めない時刻は日付での指定として扱わない', () => {
    expect(usesDayTiming({ offsetDays: -1, sendAtTime: '25:00', offsetMinutes: 0 })).toBe(false);
  });

  it('当日（0日）も日付での指定', () => {
    expect(usesDayTiming({ offsetDays: 0, sendAtTime: '09:00', offsetMinutes: 0 })).toBe(true);
  });
});

describe('resolveReminderSendAt', () => {
  describe('「○日前の●時」', () => {
    // ゴールは 2026-09-01（火）15:00
    const target = jst('2026-09-01T15:00');

    it('3日前の10時', () => {
      const at = resolveReminderSendAt(target, {
        offsetDays: -3,
        sendAtTime: '10:00',
        offsetMinutes: 0,
      }, 'time');
      expect(showJst(at)).toBe('2026-08-29 10:00');
    });

    it('当日の9時（ゴールより前の時刻でも、その日に送る）', () => {
      const at = resolveReminderSendAt(target, {
        offsetDays: 0,
        sendAtTime: '09:00',
        offsetMinutes: 0,
      }, 'time');
      expect(showJst(at)).toBe('2026-09-01 09:00');
    });

    it('翌日の18時（お礼など、ゴールの後にも送れる）', () => {
      const at = resolveReminderSendAt(target, {
        offsetDays: 1,
        sendAtTime: '18:00',
        offsetMinutes: 0,
      }, 'time');
      expect(showJst(at)).toBe('2026-09-02 18:00');
    });

    it('月をまたぐ', () => {
      const at = resolveReminderSendAt(jst('2026-09-02T10:00'), {
        offsetDays: -5,
        sendAtTime: '08:00',
        offsetMinutes: 0,
      }, 'time');
      expect(showJst(at)).toBe('2026-08-28 08:00');
    });

    it('ゴールの時刻が変わっても、送る時刻は変わらない', () => {
      // ここが分オフセットとの決定的な違い。「3日前の10時」は
      // ゴールが何時であっても 3日前の10時。
      const step = { offsetDays: -3, sendAtTime: '10:00', offsetMinutes: 0 };
      expect(showJst(resolveReminderSendAt(jst('2026-09-01T09:00'), step, 'time'))).toBe(
        '2026-08-29 10:00',
      );
      expect(showJst(resolveReminderSendAt(jst('2026-09-01T23:30'), step, 'time'))).toBe(
        '2026-08-29 10:00',
      );
    });

    it('ゴールが日本時間の朝でも、日付がずれない', () => {
      // 2026-09-01 09:00 JST = 2026-09-01 00:00 UTC。UTC のまま日を引くと
      // 前日に落ちる境目。
      const at = resolveReminderSendAt(jst('2026-09-01T09:00'), {
        offsetDays: -1,
        sendAtTime: '20:00',
        offsetMinutes: 0,
      }, 'time');
      expect(showJst(at)).toBe('2026-08-31 20:00');
    });

    it('ゴールが日本時間の深夜でも、日付がずれない', () => {
      // 2026-09-01 00:30 JST = 2026-08-31 15:30 UTC。
      const at = resolveReminderSendAt(jst('2026-09-01T00:30'), {
        offsetDays: -1,
        sendAtTime: '20:00',
        offsetMinutes: 0,
      }, 'time');
      expect(showJst(at)).toBe('2026-08-31 20:00');
    });
  });

  describe('昔からの「オフセット（分）」', () => {
    const target = jst('2026-09-01T15:00');

    it('1時間前', () => {
      expect(showJst(resolveReminderSendAt(target, { offsetMinutes: -60 }))).toBe(
        '2026-09-01 14:00',
      );
    });

    it('ゴールちょうど', () => {
      expect(showJst(resolveReminderSendAt(target, { offsetMinutes: 0 }))).toBe('2026-09-01 15:00');
    });

    it('日付での指定が半端なときは、こちらに戻る', () => {
      const at = resolveReminderSendAt(target, {
        offsetDays: -3,
        sendAtTime: null,
        offsetMinutes: -120,
      });
      expect(showJst(at)).toBe('2026-09-01 13:00');
    });
  });
});

describe('describeReminderTiming', () => {
  it('日付での指定', () => {
    expect(
      describeReminderTiming({ offsetDays: -3, sendAtTime: '10:00', offsetMinutes: 0 }, 'time'),
    ).toBe('3日前の10:00');
    expect(
      describeReminderTiming({ offsetDays: 0, sendAtTime: '09:00', offsetMinutes: 0 }, 'time'),
    ).toBe('当日の09:00');
    expect(
      describeReminderTiming({ offsetDays: 2, sendAtTime: '18:00', offsetMinutes: 0 }, 'time'),
    ).toBe('2日後の18:00');
  });

  it('オフセット（分）は、読みやすい単位に丸める', () => {
    expect(describeReminderTiming({ offsetMinutes: -1440 })).toBe('1日前');
    expect(describeReminderTiming({ offsetMinutes: -60 })).toBe('1時間前');
    expect(describeReminderTiming({ offsetMinutes: -30 })).toBe('30分前');
    expect(describeReminderTiming({ offsetMinutes: 30 })).toBe('30分後');
    expect(describeReminderTiming({ offsetMinutes: 0 })).toBe('ゴールちょうど');
  });
});
