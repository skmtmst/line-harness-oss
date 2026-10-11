// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import Confirm from './Confirm.js';
import WorkerConfirm from '../../../worker/src/client/salon-booking/components/Confirm.js';
import { ConfirmScreen } from '../../../worker/src/client/event-booking/main.js';
import { api } from '../lib/api.js';
import { createApi } from '../../../worker/src/client/salon-booking/lib/api.js';

vi.mock('../lib/api.js', () => ({ api: { createRequest: vi.fn() } }));
vi.mock('../../../worker/src/client/salon-booking/lib/api.js', () => ({ createApi: vi.fn() }));
vi.mock('../../../worker/src/client/salon-booking/lib/context.js', () => ({ useSalonContext: () => ({liffId:'fake',lineUserId:'fake',idToken:'fake'}) }));
const menu = {id:'m',name:'人工メニュー',category_label:null,description:null,duration_minutes:60,buffer_after_minutes:0,base_price:0,sort_order:0};
const staff = {id:'s',display_name:'人工担当',role:null,profile_image_url:null,bio:null,is_designation_optional:0,price:0,duration_minutes:60};
const slot = {date:'2099-01-01',start:'10:00'};
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('外部通信は禁止'); })); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it.each(['現LIFF','Worker LIFF'] as const)('XL-01: %sの送信中に戻ったあと古い成功では完了しない', async target => {
  let resolve!: (value: {booking_id:string;status:string}) => void;
  const promise = new Promise<{booking_id:string;status:string}>(r => {resolve=r;});
  if (target === '現LIFF') vi.mocked(api.createRequest).mockReturnValue(promise);
  else vi.mocked(createApi).mockReturnValue({createRequest: () => promise} as unknown as ReturnType<typeof createApi>);
  const onSubmitted=vi.fn(),onBack=vi.fn();
  render(target==='現LIFF'
    ? <Confirm menu={menu} staff={staff} slot={slot} autoConfirm={false} onBack={onBack} onSubmitted={onSubmitted}/>
    : <WorkerConfirm menu={menu} staff={staff} slot={slot} onBack={onBack} onSubmitted={onSubmitted}/>);
  fireEvent.click(screen.getByRole('button',{name:/予約をリクエスト/}));
  fireEvent.click(screen.getByRole('button',{name:/日時を選び直す|戻る/}));
  expect(onBack).toHaveBeenCalledTimes(1);
  await act(async () => {resolve({booking_id:'old',status:'confirmed'}); await promise;});
  expect(onSubmitted).not.toHaveBeenCalled();
});

it('XL-01: Workerイベントの送信中に戻ると古い成功では完了しない', async () => {
  let resolve!: (value: Response) => void;
  const promise=new Promise<Response>(r=>{resolve=r;});
  vi.stubGlobal('fetch',vi.fn(()=>promise));
  const onDone=vi.fn(),onBack=vi.fn();
  render(<ConfirmScreen ctx={{liffId:'fake',lineUserId:'fake',idToken:'fake'}}
    event={{id:'e',name:'人工イベント',venue_name:null,venue_url:null,image_url:null,description:null,description_centered:0,max_bookings_per_friend:null,requires_approval:0,cancel_deadline_hours_before:null}}
    slot={{id:'s',event_id:'e',starts_at:'2099-01-01T00:00:00Z',ends_at:'2099-01-01T01:00:00Z',capacity:1,is_active:1,active_count:0,remaining:1}}
    onBack={onBack} onDone={onDone}/>);
  fireEvent.click(screen.getByRole('button',{name:'予約をリクエスト'}));
  fireEvent.click(screen.getAllByRole('button',{name:'戻る'})[0]);
  await act(async()=>{resolve(new Response(JSON.stringify({id:'old',status:'confirmed'})));await promise;});
  expect(onDone).not.toHaveBeenCalled();
});

it.each(['現LIFF','Worker LIFF'] as const)('XL-01: %sで前の失敗は新しい送信を解除せず、新しい成功だけ採用する', async target => {
  let rejectOld!: (reason: Error) => void;
  let resolveNew!: (value: {booking_id:string;status:string}) => void;
  const old = new Promise<{booking_id:string;status:string}>((_,r)=>{rejectOld=r;});
  const next = new Promise<{booking_id:string;status:string}>(r=>{resolveNew=r;});
  if(target==='現LIFF') vi.mocked(api.createRequest).mockReturnValueOnce(old).mockReturnValueOnce(next);
  else vi.mocked(createApi).mockReturnValueOnce({createRequest:()=>old} as unknown as ReturnType<typeof createApi>).mockReturnValueOnce({createRequest:()=>next} as unknown as ReturnType<typeof createApi>);
  const onSubmitted=vi.fn();
  render(target==='現LIFF'
    ? <Confirm menu={menu} staff={staff} slot={slot} autoConfirm={false} onBack={()=>{}} onSubmitted={onSubmitted}/>
    : <WorkerConfirm menu={menu} staff={staff} slot={slot} onBack={()=>{}} onSubmitted={onSubmitted}/>);
  fireEvent.click(screen.getByRole('button',{name:/予約をリクエスト/}));
  fireEvent.click(screen.getByRole('button',{name:/日時を選び直す|戻る/}));
  fireEvent.click(screen.getByRole('button',{name:/予約をリクエスト/}));
  await act(async()=>{rejectOld(new Error('古い失敗'));await old.catch(()=>{});});
  expect(screen.getByRole('button',{name:/送信中/}).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByText(/送信に失敗/)).toBeNull();
  await act(async()=>{resolveNew({booking_id:'new',status:'requested'});await next;});
  expect(onSubmitted).toHaveBeenCalledTimes(1);
});
