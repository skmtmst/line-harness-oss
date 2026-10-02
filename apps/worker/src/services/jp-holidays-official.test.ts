/**
 * 監査 R253：祝日表が2026年までで、2027年元日の応答条件を誤判定する。
 *
 * 計算で出す祝日（`jp-holidays.ts`・祝日法の規則を再現）が、内閣府の
 * 公開表と一致することを守る。照合の正本は2つ：
 * - 2024〜2026年：共有の祝日表（内閣府CSVの写し）との全日一致
 * - 2027年：内閣府「国民の祝日について」掲載の令和9年17日
 *   （2026-09-28取得。出典 https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html）
 */
import { describe, expect, it } from 'vitest';
import { isJapaneseHoliday } from '@line-crm/shared';
import { holidaysOfYear } from './jp-holidays.js';

const datesOf = (year: number): Set<string> =>
  new Set(holidaysOfYear(year).map((h) => h.date));

describe('R253 計算の祝日は内閣府の公開表と一致する', () => {
  it('2024〜2026年は共有の祝日表（内閣府CSVの写し）と全日一致する', () => {
    for (let year = 2024; year <= 2026; year++) {
      const computed = datesOf(year);
      const day = new Date(Date.UTC(year, 0, 1));
      while (day.getUTCFullYear() === year) {
        const iso = day.toISOString().slice(0, 10);
        expect(computed.has(iso), `${iso} の判定が表と違います`).toBe(isJapaneseHoliday(iso));
        day.setUTCDate(day.getUTCDate() + 1);
      }
    }
  });

  it('2027年は内閣府掲載の17日と一致する', () => {
    expect([...datesOf(2027)].sort()).toEqual(
      [
        '2027-01-01', // 元日（金）
        '2027-01-11', // 成人の日
        '2027-02-11', // 建国記念の日
        '2027-02-23', // 天皇誕生日（火）
        '2027-03-21', // 春分の日（日）
        '2027-03-22', // 振替休日
        '2027-04-29', // 昭和の日
        '2027-05-03', // 憲法記念日
        '2027-05-04', // みどりの日
        '2027-05-05', // こどもの日
        '2027-07-19', // 海の日
        '2027-08-11', // 山の日
        '2027-09-20', // 敬老の日
        '2027-09-23', // 秋分の日
        '2027-10-11', // スポーツの日
        '2027-11-03', // 文化の日
        '2027-11-23', // 勤労感謝の日
      ].sort(),
    );
  });

  it('2027年の国民の休日に当たらない平日を祝日にしない（9/21・9/22）', () => {
    const computed = datesOf(2027);
    // 9/20（祝）・9/23（祝）に挟まれるが、前後どちらかが平日のため休日にならない。
    expect(computed.has('2027-09-21')).toBe(false);
    expect(computed.has('2027-09-22')).toBe(false);
  });
});
