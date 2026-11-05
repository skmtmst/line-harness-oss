import { describe, expect, it } from 'vitest';
import { emptyHoursWorkspace, hoursDateRange } from '@line-crm/shared';
import { hoursWorkspaceEvent } from './google-hours-history.js';

describe('営業時間の履歴に残す実際の変更', () => {
 it('離れた日付の間を休業期間と表示しない', () => {
  const next=emptyHoursWorkspace();next.draft.days=['2026-12-14','2026-12-18'].map(date=>({date,closed:true,periods:[]}));
  expect(hoursWorkspaceEvent(emptyHoursWorkspace(),next,false)).toMatchObject({googleState:'draft',description:'12月14日・12月18日を休業'});
 });
 it('年をまたぐ連続日とそのメモを保持する', () => {
  const next=emptyHoursWorkspace();next.draft.days=hoursDateRange('2026-12-30','2027-01-03').map(date=>({date,closed:true,periods:[]}));for(const day of next.draft.days)next.notes[day.date]='年末年始の休業';
  expect(hoursWorkspaceEvent(emptyHoursWorkspace(),next,false)).toMatchObject({summary:'年末年始の休業を追加',description:'12月30日 – 1月3日を休業',googleState:'draft'});
  expect(hoursWorkspaceEvent(next,{...next,draft:emptyHoursWorkspace().draft},true)).toMatchObject({googleState:'sent',description:'12月30日 – 1月3日を休業'});
 });
 it('確認画面の識別子だけでは編集履歴を増やさない', () => {
  const next=emptyHoursWorkspace();next.draft.reviewIds=['review'];expect(hoursWorkspaceEvent(emptyHoursWorkspace(),next,false)).toBeNull();
 });
});
