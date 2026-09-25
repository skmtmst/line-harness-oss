import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatJp,
  formatMd,
  formatWeekday,
  jstStartsAtIso,
  utcToJstDisplay,
  utcToJstHm,
  utcToJstMd,
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
