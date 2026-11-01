// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LessonHistorySection from './lesson-history-section.js';
import { api, type EventBookingMine, type MakeupCredit, type MakeupOption } from '../lib/api.js';
vi.mock('../lib/api.js', () => ({ api: { myEventBookings: vi.fn(), makeupCredits: vi.fn(), makeupOptions: vi.fn(), useMakeup: vi.fn(), eventAbsence: vi.fn() } }));
const a: MakeupCredit = { id:'a', status:'open', expires_at:'2026-11-15T14:59:59Z', source_event_booking_id:'old-a' };
const b: MakeupCredit = { id:'b', status:'open', expires_at:'2026-11-30T14:59:59Z', source_event_booking_id:'old-b' };
const c: MakeupCredit = { id:'c', status:'open', expires_at:'2026-12-10T14:59:59Z', source_event_booking_id:'lesson' };
const booking = { id:'lesson', status:'confirmed', event_id:'lesson-event', event_name:'欠席するクラス', slot_starts_at:'2026-11-02T01:00:00Z', slot_ends_at:'2026-11-02T02:00:00Z', makeup:{enabled:true,cutoff_at:'2026-11-01T22:00:00Z'} } as EventBookingMine;
const option = (id: string): MakeupOption => ({ slot_id:`slot-${id}`, event_id:`event-${id}`, name:`${id}の候補`, starts_at:'2026-11-05T10:00:00Z', ends_at:'2026-11-05T11:00:00Z', full:false, remaining:2 });
function deferred<T>() { let resolve!: (value:T)=>void; let reject!: (error:unknown)=>void; const promise = new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }
function choices() { return screen.getByRole('group',{name:'使う振替'}); }
function choose(expiry: string) { return within(choices()).getByRole('button',{name:new RegExp(expiry)}); }
function band() { return document.querySelector('[data-makeup-band]')!.textContent!; }
let rows: MakeupCredit[];
beforeEach(()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-01T03:00:00Z'));rows=[a,b];
 vi.mocked(api.myEventBookings).mockResolvedValue({items:[]});
 vi.mocked(api.makeupCredits).mockImplementation(async()=>({credits:rows}));
 vi.mocked(api.makeupOptions).mockImplementation(async id=>({options:[option(id)]}));
 vi.mocked(api.useMakeup).mockResolvedValue({id:'new-booking',status:'confirmed'});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.resetAllMocks();});
it('先頭に空きがなくても2券目だけを選び、その券と候補だけを送る',async()=>{
 vi.mocked(api.makeupOptions).mockImplementation(async id=>({options:id==='a'?[]:[option(id)]}));
 render(<LessonHistorySection creditsOnly/>);
 await screen.findByText('期限内に空いている回がありません。教室にご相談ください。');
 expect(within(choices()).getAllByRole('button')).toHaveLength(2);
 expect(choose('11/15').getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(choose('11/30'));
 await screen.findByText('bの候補');
 expect(choose('11/30').getAttribute('aria-pressed')).toBe('true');
 expect(band()).toContain('11/30');
 expect(document.querySelectorAll('[data-liff-bottom-bar]')).toHaveLength(1);
 expect(screen.getAllByRole('heading',{name:'振替先を選ぶ'})).toHaveLength(1);
 fireEvent.click(await screen.findByRole('button',{name:/に振り替える$/}));
 await vi.waitFor(()=>expect(api.useMakeup).toHaveBeenCalledWith('b','slot-b',expect.any(String)));
 expect(api.useMakeup).toHaveBeenCalledTimes(1);
});
it('1券目の遅いGETを2券目の候補や選択に混ぜない',async()=>{
 const late=deferred<{options:MakeupOption[]}>();
 vi.mocked(api.makeupOptions).mockImplementation(async id=>id==='a'?late.promise:{options:[option(id)]});
 render(<LessonHistorySection creditsOnly/>);
 await vi.waitFor(()=>expect(api.makeupOptions).toHaveBeenCalledWith('a',expect.any(String)));
 fireEvent.click(choose('11/30'));await screen.findByText('bの候補');
 await act(async()=>{late.resolve({options:[option('a')]});});
 expect(screen.queryByText('aの候補')).toBeNull();expect(band()).toContain('11/30');
 fireEvent.click(screen.getByRole('button',{name:/に振り替える$/}));
 await vi.waitFor(()=>expect(api.useMakeup).toHaveBeenCalledWith('b','slot-b',expect.any(String)));
});
it('送信開始と同時に新選択を止め、失敗で戻し、同じ券の再試行キーを保つ',async()=>{
 const result=deferred<{id:string;status:'confirmed'}>();vi.mocked(api.useMakeup).mockReturnValueOnce(result.promise);
 render(<LessonHistorySection creditsOnly/>);await screen.findByText('aの候補');
 const second=choose('11/30');const submit=screen.getByRole('button',{name:/に振り替える$/});
 act(()=>{fireEvent.click(submit);fireEvent.click(second);});fireEvent.click(submit);
 expect(second.hasAttribute('disabled')).toBe(true);expect(band()).toContain('11/15');expect(api.useMakeup).toHaveBeenCalledTimes(1);
 const first=vi.mocked(api.useMakeup).mock.calls[0];
 await act(async()=>{result.reject(new Error('network_failure'));});
 await screen.findByRole('alert');expect(second.hasAttribute('disabled')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:/に振り替える$/}));
 await vi.waitFor(()=>expect(api.useMakeup).toHaveBeenCalledTimes(2));
 expect(vi.mocked(api.useMakeup).mock.calls[1]).toEqual(first);
});
it.each([false,true])('読み直しで選択券が消える=%sなら対応する券を表示する',async removed=>{
 vi.mocked(api.useMakeup).mockImplementation(async()=>{rows=removed?[a,c]:[a,b,c];return{id:'new',status:'confirmed'};});
 render(<LessonHistorySection creditsOnly/>);await screen.findByText('aの候補');
 fireEvent.click(choose('11/30'));await screen.findByText('bの候補');
 fireEvent.click(screen.getByRole('button',{name:/に振り替える$/}));
 await vi.waitFor(()=>expect(within(choices()).getAllByRole('button')).toHaveLength(removed?2:3));
 await vi.waitFor(()=>expect(choose(removed?'11/15':'11/30').getAttribute('aria-pressed')).toBe('true'));
 expect(band()).toContain(removed?'11/15':'11/30');
});
it.each(['none','one','expired','unknown-expiry'] as const)('0/1券と期限の既存状態 %sを保つ',async kind=>{
 rows=kind==='none'?[]:kind==='one'?[a]:kind==='expired'?[{...a,expires_at:'2026-10-01T00:00:00Z'}]:[{...a,expires_at:'invalid'}];
 render(<LessonHistorySection creditsOnly/>);
 await vi.waitFor(()=>expect(api.makeupCredits).toHaveBeenCalledTimes(1));
 if(kind==='one')await screen.findByText('aの候補');
 if(kind==='expired')await screen.findByText('振替の期限を過ぎています');
 if(kind==='unknown-expiry')await screen.findByText('振替の期限を読み込めませんでした');
 expect(screen.queryByRole('group',{name:'使う振替'})).toBeNull();
 if(kind!=='one')expect(api.makeupOptions).not.toHaveBeenCalled();expect(api.useMakeup).not.toHaveBeenCalled();
});
it('欠席直後の元を別券へ使わず、選んだ券のID・欠席元・期限をそろえる',async()=>{
 const old={...booking,id:'old-a',event_name:'以前のクラス',slot_starts_at:'2026-10-20T01:00:00Z'};
 vi.mocked(api.myEventBookings).mockImplementation(async tab=>({items:tab==='past'?[old]:[booking]}));
 vi.mocked(api.eventAbsence).mockImplementation(async()=>{rows=[a,b,c];return{credit:c,reason_if_none:undefined};});
 render(<LessonHistorySection/>);await screen.findByText('aの候補');
 fireEvent.click(screen.getByRole('button',{name:'欠席する'}));
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'欠席する'}));
 await vi.waitFor(()=>expect(within(choices()).getAllByRole('button')).toHaveLength(3));
 expect(band()).toContain('以前のクラス');expect(band()).not.toContain('欠席するクラス');
 fireEvent.click(choose('12/10'));await screen.findByText('cの候補');
 expect(band()).toContain('欠席するクラス');expect(band()).toContain('12/10');
 fireEvent.click(choose('11/30'));await screen.findByText('bの候補');
 expect(band()).not.toContain('欠席するクラス');expect(band()).not.toContain('以前のクラス');
});
it('送信中のPickerが読み直しで消えたら解除し、古いfalseが新券の送信を解除しない',async()=>{
 const first=deferred<{id:string;status:'confirmed'}>(),second=deferred<{id:string;status:'confirmed'}>();
 vi.mocked(api.useMakeup).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
 vi.mocked(api.myEventBookings).mockResolvedValue({items:[booking]});
 vi.mocked(api.eventAbsence).mockImplementation(async()=>{rows=[b,c];return{credit:null,reason_if_none:'monthly_cap'};});
 const changed=vi.fn();render(<LessonHistorySection onBookingChanged={changed}/>);await screen.findByText('aの候補');
 fireEvent.click(screen.getByRole('button',{name:/に振り替える$/}));expect(choose('11/30').hasAttribute('disabled')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'欠席する'}));
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'欠席する'}));
 await screen.findByText('bの候補');await vi.waitFor(()=>expect(choose('12/10').hasAttribute('disabled')).toBe(false));
 fireEvent.click(screen.getByRole('button',{name:/に振り替える$/}));
 expect(choose('12/10').hasAttribute('disabled')).toBe(true);
 await act(async()=>{first.resolve({id:'old-success',status:'confirmed'});});
 expect(choose('12/10').hasAttribute('disabled')).toBe(true);expect(changed).not.toHaveBeenCalled();
 await act(async()=>{second.reject(new Error('temporary'));});
 await screen.findByRole('alert');expect(choose('12/10').hasAttribute('disabled')).toBe(false);
 expect(vi.mocked(api.useMakeup).mock.calls.map(call=>call.slice(0,2))).toEqual([['a','slot-a'],['b','slot-b']]);
});
it('取得失敗を空券にせず、既存再読込から戻れる',async()=>{
 vi.mocked(api.makeupCredits).mockRejectedValueOnce(new Error('temporary'));
 render(<LessonHistorySection creditsOnly/>);
 await screen.findByText(/教室の予約・振替の履歴はなくなっていません/);
 fireEvent.click(screen.getByRole('button',{name:/もう一度|読み直す/}));
 await screen.findByText('aの候補');expect(within(choices()).getAllByRole('button')).toHaveLength(2);
});

it('欠席結果の券IDが合っても元予約が違う時は欠席元を補わない',async()=>{
 vi.mocked(api.myEventBookings).mockResolvedValue({items:[booking]});
 const mismatched={...c,source_event_booking_id:'unknown-source'};
 vi.mocked(api.eventAbsence).mockImplementation(async()=>{rows=[a,mismatched];return{credit:mismatched,reason_if_none:undefined};});
 render(<LessonHistorySection/>);await screen.findByText('aの候補');
 fireEvent.click(screen.getByRole('button',{name:'欠席する'}));
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'欠席する'}));
 await screen.findByRole('button',{name:/12\/10/});fireEvent.click(choose('12/10'));await screen.findByText('cの候補');
 expect(band()).not.toContain('欠席するクラス');expect(band()).not.toContain('を欠席にしました');
});
