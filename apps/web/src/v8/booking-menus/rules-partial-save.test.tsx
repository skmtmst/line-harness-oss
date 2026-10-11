// @vitest-environment happy-dom
import React from 'react';
import {render,screen,fireEvent,act,cleanup,waitFor} from '@testing-library/react';
import {vi,it,expect,afterEach} from 'vitest';
const m=vi.hoisted(()=>({save:vi.fn(),staff:vi.fn(),onSave:null as null|(()=>void),saved:vi.fn()}));
vi.mock('@/lib/api',async(original)=>{const a=await original<any>();return {...a,api:{},bookingApi:{saveSettings:m.save,updateStaff:m.staff}}});
vi.mock('@/v8/booking-menus/tabs/shared',async(original)=>({...await original<any>(),useV8TabEdit:(o:any)=>{m.onSave=o.onSave}}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));
import {RulesTabV8} from '@/v8/booking-menus/tabs/rules-tab';
afterEach(()=>{cleanup();vi.clearAllMocks()});
it('UI-N04 担当更新の途中失敗後は保存済みの版で再試行する',async()=>{
 const settings:any={version:3,timeZone:'Asia/Tokyo',bookingWindowDays:30,cutoffMinutesBefore:60,cancelDeadlineMinutesBefore:60,maxActiveBookingsPerFriend:3,approvalMode:'auto',holdMinutes:10,slotGranularityMinutes:30,businessHours:[],exceptions:[]};
 m.save.mockResolvedValue({success:true,data:{...settings,version:4}});m.staff.mockRejectedValue(new Error('fixture staff unavailable'));
 render(<RulesTabV8 accountId="fixture-a" settings={settings} status="ready" error={null} staff={[{id:'s',is_active:1,is_designation_optional:0} as any]} staffReady canEdit onSaved={m.saved} onReload={()=>{}}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'「指名なし」を出す'}));await act(async()=>m.onSave!());await waitFor(()=>expect(m.staff).toHaveBeenCalledTimes(1));await act(async()=>m.onSave!());
 expect(m.save.mock.calls.map(c=>c[1].expectedVersion)).toEqual([3,4]);expect(m.saved).not.toHaveBeenCalled();
});

it('担当を一部だけ更新できた時は、再試行で未完了の担当だけ更新する',async()=>{
 const settings:any={version:3,timeZone:'Asia/Tokyo',bookingWindowDays:30,cutoffMinutesBefore:60,cancelDeadlineMinutesBefore:60,maxActiveBookingsPerFriend:3,approvalMode:'auto',holdMinutes:10,slotGranularityMinutes:30,businessHours:[],exceptions:[]};
 m.save.mockResolvedValue({success:true,data:{...settings,version:4}});
 m.staff.mockReset().mockResolvedValueOnce({success:true}).mockRejectedValueOnce(new Error('synthetic staff failure')).mockResolvedValue({success:true});
 render(<RulesTabV8 accountId="fixture-a" settings={settings} status="ready" error={null} staff={[{id:'s1',is_active:1,is_designation_optional:0},{id:'s2',is_active:1,is_designation_optional:0}] as any} staffReady canEdit onSaved={m.saved} onReload={()=>{}}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'「指名なし」を出す'}));await act(async()=>m.onSave!());await waitFor(()=>expect(m.staff).toHaveBeenCalledTimes(2));await act(async()=>m.onSave!());
 await waitFor(()=>expect(m.saved).toHaveBeenCalled());
 expect(m.staff.mock.calls.map(c=>c[1])).toEqual(['s1','s2','s2']);
})
