import { describe, expect, test } from 'vitest';
import { computeSlots, type BusyInterval, type Interval } from './availability.js';

const MENU_60 = { duration_minutes: 60, buffer_after_minutes: 0 };
const WORKING: Interval[] = [{ start: '10:00', end: '13:00' }];

/** 同じメニューの予約。定員まで重ねられる。 */
function same(start: string, end: string): BusyInterval {
  return { start, end, sameMenu: true };
}

/** 別メニューの予約や外の予定。定員に関係なく塞ぐ。 */
function other(start: string, end: string): BusyInterval {
  return { start, end };
}

describe('同時受付数', () => {
  test('指定しなければ1件で塞ぐ（従来どおり）', () => {
    const slots = computeSlots({
      working: WORKING,
      busy: [same('11:00', '12:00')],
      menu: MENU_60,
      granularityMinutes: 30,
    });
    expect(slots).toEqual([
      { start: '10:00', end: '11:00' },
      { start: '12:00', end: '13:00' },
    ]);
  });

  test('定員2なら、同じメニューの予約が1件でも枠は残る', () => {
    const slots = computeSlots({
      working: WORKING,
      busy: [same('11:00', '12:00')],
      menu: MENU_60,
      granularityMinutes: 30,
      capacity: 2,
    });
    expect(slots.map((s) => s.start)).toEqual(['10:00', '10:30', '11:00', '11:30', '12:00']);
  });

  test('定員2で、同じメニューが2件重なれば塞がる', () => {
    const slots = computeSlots({
      working: WORKING,
      busy: [same('11:00', '12:00'), same('11:00', '12:00')],
      menu: MENU_60,
      granularityMinutes: 30,
      capacity: 2,
    });
    // 11:00 開始の枠は2件と重なるので消える。10:30 も 11:00-11:30 に重なるため消える。
    expect(slots.map((s) => s.start)).toEqual(['10:00', '12:00']);
  });

  test('別メニューの予約は、定員がいくつでも1件で塞ぐ', () => {
    // 1対1の施術とグループを同じ時間に入れることはできない。
    const slots = computeSlots({
      working: WORKING,
      busy: [other('11:00', '12:00')],
      menu: MENU_60,
      granularityMinutes: 30,
      capacity: 5,
    });
    expect(slots.map((s) => s.start)).toEqual(['10:00', '12:00']);
  });

  test('同じメニューと別メニューが混ざっても、別メニューが優先して塞ぐ', () => {
    const slots = computeSlots({
      working: WORKING,
      busy: [same('11:00', '12:00'), other('11:00', '12:00')],
      menu: MENU_60,
      granularityMinutes: 30,
      capacity: 5,
    });
    expect(slots.map((s) => s.start)).toEqual(['10:00', '12:00']);
  });

  test('定員が0や負でも、枠が全部消えたりはしない', () => {
    // 設定ミスで予約が一切取れなくなる方が、事故として大きい。
    const slots = computeSlots({
      working: WORKING,
      busy: [],
      menu: MENU_60,
      granularityMinutes: 30,
      capacity: 0,
    });
    expect(slots.length).toBeGreaterThan(0);
  });

  test('重ならない時間帯の予約は定員を消費しない', () => {
    const slots = computeSlots({
      working: WORKING,
      busy: [same('09:00', '10:00')],
      menu: MENU_60,
      granularityMinutes: 30,
      capacity: 1,
    });
    expect(slots.map((s) => s.start)).toEqual(['10:00', '10:30', '11:00', '11:30', '12:00']);
  });
});
