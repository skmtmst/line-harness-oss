// @vitest-environment happy-dom
import React from 'react';
import {render,screen,fireEvent,act,cleanup,waitFor} from '@testing-library/react';
import {vi,it,expect,afterEach} from 'vitest';
const m=vi.hoisted(()=>({save:vi.fn(),staff:vi.fn(),onSave:null as null|(()=>void),saved:vi.fn()}));
vi.mock('@/lib/api',async(original)=>{const a=await original<typeof import('@/lib/api')>();return {...a,api:{},bookingApi:{saveSettings:m.save,updateStaff:m.staff}}});
vi.mock('@/v8/booking-menus/tabs/shared',async(original)=>({...await original<typeof import('@/v8/booking-menus/tabs/shared')>(),useV8TabEdit:(o:Parameters<typeof import('@/v8/booking-menus/tabs/shared').useV8TabEdit>[0])=>{m.onSave=o.onSave}}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));
import {RulesTabV8} from '@/v8/booking-menus/tabs/rules-tab';
afterEach(()=>{cleanup();vi.clearAllMocks()});
it('UI-N04 担当更新の途中失敗後は保存済みの版で再試行する',async()=>{
 const settings={version:3,timeZone:'Asia/Tokyo',bookingWindowDays:30,cutoffMinutesBefore:60,cancelDeadlineMinutesBefore:60,maxActiveBookingsPerFriend:3,approvalMode:'auto',holdMinutes:10,slotGranularityMinutes:30,businessHours:[],exceptions:[]} as unknown as React.ComponentProps<typeof RulesTabV8>['settings'];
 m.save.mockResolvedValue({success:true,data:{...settings,version:4}});m.staff.mockRejectedValue(new Error('fixture staff unavailable'));
 render(<RulesTabV8 accountId="fixture-a" settings={settings} status="ready" error={null} staff={[{id:'s',is_active:1,is_designation_optional:0} as unknown as React.ComponentProps<typeof RulesTabV8>['staff'][number]]} staffReady canEdit onSaved={m.saved} onReload={()=>{}}/>);
 fireEvent.click(screen.getByRole('switch',{name:'「指名なし」を出す'}));await act(async()=>m.onSave!());await waitFor(()=>expect(m.staff).toHaveBeenCalledTimes(1));await act(async()=>m.onSave!());
 // ：同じ内容の再試行で、完了したルールを再保存しない。
 expect(m.save.mock.calls.map(c=>c[1].expectedVersion)).toEqual([3]);expect(m.staff).toHaveBeenCalledTimes(2);expect(m.saved).not.toHaveBeenCalled();
});

it('担当を一部だけ更新できた時は、再試行で未完了の担当だけ更新する',async()=>{
 const settings={version:3,timeZone:'Asia/Tokyo',bookingWindowDays:30,cutoffMinutesBefore:60,cancelDeadlineMinutesBefore:60,maxActiveBookingsPerFriend:3,approvalMode:'auto',holdMinutes:10,slotGranularityMinutes:30,businessHours:[],exceptions:[]} as unknown as React.ComponentProps<typeof RulesTabV8>['settings'];
 m.save.mockResolvedValue({success:true,data:{...settings,version:4}});
 m.staff.mockReset().mockResolvedValueOnce({ok:true}).mockRejectedValueOnce(new Error('synthetic staff failure')).mockResolvedValue({ok:true});
 render(<RulesTabV8 accountId="fixture-a" settings={settings} status="ready" error={null} staff={[{id:'s1',is_active:1,is_designation_optional:0},{id:'s2',is_active:1,is_designation_optional:0}] as unknown as React.ComponentProps<typeof RulesTabV8>['staff']} staffReady canEdit onSaved={m.saved} onReload={()=>{}}/>);
 fireEvent.click(screen.getByRole('switch',{name:'「指名なし」を出す'}));await act(async()=>m.onSave!());await waitFor(()=>expect(m.staff).toHaveBeenCalledTimes(2));await act(async()=>m.onSave!());
 await waitFor(()=>expect(m.saved).toHaveBeenCalled());
 expect(m.staff.mock.calls.map(c=>c[1])).toEqual(['s1','s2','s2']);
})

it('数の欄の必須と保存検査をそろえ、欄下の理由と入力を保つ', async () => {
 const settings={version:3,timeZone:'Asia/Tokyo',bookingWindowDays:30,cutoffMinutesBefore:60,cancelDeadlineMinutesBefore:60,maxActiveBookingsPerFriend:3,approvalMode:'auto',holdMinutes:10,slotGranularityMinutes:30,reminderHoursBefore:4,businessHours:[],exceptions:[]} as unknown as React.ComponentProps<typeof RulesTabV8>['settings'];
 render(<RulesTabV8 accountId="fixture-a" settings={settings} status="ready" error={null} staff={[]} staffReady canEdit onSaved={m.saved} onReload={()=>{}}/>);
 const hold=screen.getByLabelText('仮押さえの保持時間') as HTMLInputElement;
 expect(hold.getAttribute('aria-required')).toBe('true');
 fireEvent.change(hold,{target:{value:'0'}});await act(async()=>m.onSave!());
 expect(m.save).not.toHaveBeenCalled();expect(hold.value).toBe('0');expect(hold.getAttribute('aria-invalid')).toBe('true');
 const reason=screen.getByText('仮押さえの保持時間は1〜1440分で指定してください。');
 expect(hold.getAttribute('aria-describedby')?.split(' ')).toContain(reason.id);
 fireEvent.change(hold,{target:{value:'20'}});
 expect(screen.queryByText('仮押さえの保持時間は1〜1440分で指定してください。')).toBeNull();
 expect(hold.value).toBe('20');
})
