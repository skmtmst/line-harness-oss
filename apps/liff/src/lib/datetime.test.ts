import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatJp,
  formatHoldLeft,
  formatJstDeadline,
  formatJstEventAt,
  formatJstEventSpan,
  formatMd,
  formatWeekday,
  jstStartsAtIso,
  utcToJstDisplay,
  utcToJstHm,
  utcToJstMd,
  utcToJstWeekday,
} from './datetime.js';

describe('予約の日付の見せ方', () => {
  it('M/D と曜日を分けて出せる (操作の帯・日付の札)', () => {
    expect(formatMd('2026-10-01')).toBe('10/1');
    expect(formatWeekday('2026-10-01')).toBe('木');
    expect(formatJp('2026-10-01')).toBe('10/1(木)');
  });

  it('履歴の日付の四角は JST の M/D と HH:MM', () => {
    // 2026-10-01T10:00+09:00 = 2026-10-01T01:00Z。JST に戻して表示する。
    expect(utcToJstMd('2026-10-01T01:00:00Z')).toBe('10/1');
    expect(utcToJstHm('2026-10-01T01:00:00Z')).toBe('10:00');
    expect(utcToJstDisplay('2026-10-01T01:00:00Z')).toBe('2026-10-01 10:00');
  });

  it('日をまたぐ JST 変換 (UTC の日付をそのまま出さない)', () => {
    // 2026-10-01T00:30+09:00 = 2026-09-30T15:30Z。JST では 10/1。
    expect(utcToJstMd('2026-09-30T15:30:00Z')).toBe('10/1');
    expect(utcToJstHm('2026-09-30T15:30:00Z')).toBe('00:30');
  });

  it('送る時刻は JST の壁時計で ISO 化する (動きはそのまま)', () => {
    expect(jstStartsAtIso('2026-10-01', '10:00')).toBe('2026-10-01T01:00:00.000Z');
    expect(addDays('2026-10-01', 13)).toBe('2026-10-14');
  });
});

describe('イベントの日時の見せ方', () => {
  it('1時点は M月D日（曜）HH:MM', () => {
    // 2026-10-11 は日曜。04:00Z は JST の 13:00。
    expect(formatJstEventAt('2026-10-11T04:00:00Z')).toBe('10月11日（日）13:00');
    expect(utcToJstWeekday('2026-10-11T04:00:00Z')).toBe('日');
  });

  it('同じ日なら終わりの時刻だけ足す', () => {
    expect(formatJstEventSpan('2026-10-11T04:00:00Z', '2026-10-11T06:00:00Z')).toBe(
      '10月11日（日）13:00〜15:00',
    );
  });

  it('日またぎは両日を出す (UTC の日付をそのまま出さない)', () => {
    // JST の 10/11 23:00 〜 10/12 01:00。
    expect(formatJstEventSpan('2026-10-11T14:00:00Z', '2026-10-11T16:00:00Z')).toBe(
      '10月11日（日）23:00 〜 10月12日（月）01:00',
    );
  });

  it('取り消しの締め切りは始まりの何時間前かを JST の日時で出す（日をまたいで戻る）', () => {
    // 始まり JST 10/11 10:00、16 時間前 → JST 10/10 18:00。
    expect(formatJstDeadline('2026-10-11T10:00:00+09:00', 16)).toBe('10月10日 18:00');
    expect(formatJstDeadline('2026-10-11T01:00:00Z', 0)).toBe('10月11日 10:00');
  });

  it('取っておく残り時間は時間と分、1時間未満は分だけ', () => {
    expect(formatHoldLeft(23 * 3600 + 41 * 60 + 30)).toBe('23時間 41分');
    expect(formatHoldLeft(41 * 60 + 59)).toBe('41分');
  });
});
