// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MakeupPicker from './makeup-picker.js';
import { api, type MakeupCredit } from '../lib/api.js';
vi.mock('../lib/api.js',()=>({api:{makeupOptions:vi.fn(),useMakeup:vi.fn()}}));
const credit:MakeupCredit={id:'a',status:'open',expires_at:'2026-11-30T14:59:59Z'};
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-01T03:00:00Z'));vi.mocked(api.makeupOptions).mockResolvedValue({options:[{slot_id:'s',event_id:'e',name:'候補',starts_at:'2026-11-02T01:00:00Z',ends_at:'2026-11-02T02:00:00Z',remaining:1,full:false}]});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.resetAllMocks();});
it('送信開始と終了を任意口へ通知する',async()=>{
 const notify=vi.fn();vi.mocked(api.useMakeup).mockImplementation(async()=>{expect(notify).toHaveBeenLastCalledWith(true);return{id:'booked',status:'confirmed'};});
 render(<MakeupPicker credit={credit} onUsed={()=>{}} onBusyChange={notify}/>);
 fireEvent.click(await screen.findByRole('button',{name:/に振り替える$/}));
 await vi.waitFor(()=>expect(notify).toHaveBeenLastCalledWith(false));expect(notify.mock.calls).toEqual([[true],[false]]);
});
it('送信中に消えたらfalseを返し、その後の古い結果を通知しない',async()=>{
 let finish!:()=>void;vi.mocked(api.useMakeup).mockImplementation(()=>new Promise(resolve=>{finish=()=>resolve({id:'old',status:'confirmed'});}));
 const notify=vi.fn(),used=vi.fn();const view=render(<MakeupPicker credit={credit} onUsed={used} onBusyChange={notify}/>);
 fireEvent.click(await screen.findByRole('button',{name:/に振り替える$/}));expect(notify).toHaveBeenLastCalledWith(true);
 view.unmount();expect(notify).toHaveBeenLastCalledWith(false);const count=notify.mock.calls.length;
 await act(async()=>finish());expect(notify).toHaveBeenCalledTimes(count);expect(used).not.toHaveBeenCalled();
});
