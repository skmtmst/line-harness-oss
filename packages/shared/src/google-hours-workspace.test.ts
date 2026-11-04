import { describe, expect, it } from 'vitest';
import { effectiveOpeningDate, emptyHoursWorkspace, HOURS_WEEKDAYS, hoursDateRange, upcomingHolidayGroups, type OpeningWeek } from './google-hours-workspace.js';
const weekly = Object.fromEntries(HOURS_WEEKDAYS.map(d => [d, d === 'WEDNESDAY' ? [] : [{ open: '11:00', close: '22:00' }]])) as OpeningWeek;
describe('営業時間の例外と連休', () => {
 it('定休日の祝日を営業にするか、曜日を優先するかを切り替える', () => {
  const rule = { ...emptyHoursWorkspace().holiday, mode: 'custom' as const };
  expect(effectiveOpeningDate('2027-05-05', weekly, [], rule, true).closed).toBe(false);
  expect(effectiveOpeningDate('2027-05-05', weekly, [], {...rule, overrideClosedWeekday:false}, true).closed).toBe(true);
 });
 it('年末年始や個別の休業は祝日の営業よりも優先する', () => {
  const rule = { ...emptyHoursWorkspace().holiday, mode: 'custom' as const };
  expect(effectiveOpeningDate('2027-01-01',weekly,[{date:'2027-01-01',closed:true,periods:[]}],rule,true).closed).toBe(true);
 });
 it('直近3祝日を使い、GWは3日で切らずに連休の最終日まで表示する', () => {
  const holidays=[{date:'2027-04-29',name:'昭和の日'},{date:'2027-05-03',name:'憲法記念日'},{date:'2027-05-04',name:'みどりの日'},{date:'2027-05-05',name:'こどもの日'},{date:'2027-07-19',name:'海の日'}];
  expect(upcomingHolidayGroups(holidays,'2027-04-28').map(g=>g.dates)).toEqual([['2027-04-29'],['2027-05-01','2027-05-02','2027-05-03','2027-05-04','2027-05-05']]);
 });
 it('年をまたぐ期間と、開始日より前の終了日を扱う', () => {
  expect(hoursDateRange('2026-12-30','2027-01-03')).toHaveLength(5);
  expect(hoursDateRange('2027-01-03','2026-12-30')).toEqual([]);
 });
});
