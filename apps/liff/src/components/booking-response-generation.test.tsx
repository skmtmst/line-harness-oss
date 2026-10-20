// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import Confirm from './confirm.js';
import { ConfirmScreen } from '../../../worker/src/client/event-booking/main.js';
import { api } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ api: { cancellationPreview: vi.fn().mockResolvedValue({ enabled: false, version: 0, freeUntil: null, afterPercent: 50, noShowPercent: 100, price: 0, deposit: null }), entitlements: vi.fn().mockResolvedValue([]), createRequest: vi.fn() } }));
const menu = {id:'m',name:'人工メニュー',category_label:null,description:null,duration_minutes:60,buffer_after_minutes:0,base_price:0,sort_order:0};
const staff = {id:'s',display_name:'人工担当',role:null,profile_image_url:null,bio:null,is_designation_optional:0,price:0,duration_minutes:60};
const slot = {date:'2099-01-01',start:'10:00'};
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('外部通信は禁止'); })); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('REV-H2: 支払い必須なのに記録がない応答では完了へ進まない', async () => {
  vi.mocked(api.createRequest).mockResolvedValue({ booking_id: 'b', status: 'requested', payment_required: true } as never);
  const onSubmitted = vi.fn();
  render(<Confirm menu={menu} staff={staff} slot={slot} autoConfirm={true} onSubmitted={onSubmitted}/>);
  await vi.waitFor(() => expect((screen.getByRole('button', { name: /予約を確定/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: /予約を確定/ }));
  await act(async () => {});
  expect(onSubmitted).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('予約できませんでした');
});

it('REV-I2: 表示後に手動承認へ変わっても支払い不要の受付結果を採用する', async () => {
  vi.mocked(api.createRequest).mockResolvedValue({ booking_id: 'b', status: 'requested', payment_required: false });
  const onSubmitted = vi.fn();
  render(<Confirm menu={menu} staff={staff} slot={slot} autoConfirm={true} onSubmitted={onSubmitted}/>);
  await vi.waitFor(() => expect((screen.getByRole('button', { name: /予約を確定/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: /予約を確定/ }));
  await act(async () => {});
  expect(onSubmitted).toHaveBeenCalledWith({ bookingId: 'b', status: 'requested', payment: null, prepayNotice: null });
  expect(screen.queryByRole('alert')).toBeNull();
});

it('REV-I2: 表示後に店払いへ変わっても古いonlineの表示で成功を拒まない', async () => {
  vi.mocked(api.createRequest).mockResolvedValue({ booking_id: 'b', status: 'requested', payment_required: false });
  const onSubmitted = vi.fn();
  render(<Confirm menu={{...menu, payment_mode: 'online'}} staff={{...staff, price: 1000}} slot={slot} autoConfirm={false} onSubmitted={onSubmitted}/>);
  await vi.waitFor(() => expect((screen.getByRole('button', { name: /予約をリクエスト/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: /予約をリクエスト/ }));
  await act(async () => {});
  expect(onSubmitted).toHaveBeenCalledWith({ bookingId: 'b', status: 'requested', payment: null, prepayNotice: null });
  expect(screen.queryByRole('alert')).toBeNull();
});

it('XL-01: 共通予約の送信中に戻ったあと古い成功では完了しない', async () => {
  // 戻るは頭の「‹」（Booking）。確認の段が外れると世代が進み、古い応答は捨てる。
  let resolve!: (value: {booking_id:string;status:string}) => void;
  const promise = new Promise<{booking_id:string;status:string}>(r => {resolve=r;});
  vi.mocked(api.createRequest).mockReturnValue(promise);
  const onSubmitted=vi.fn();
  const view = render(<Confirm menu={menu} staff={staff} slot={slot} autoConfirm={false} onSubmitted={onSubmitted}/>);
  await vi.waitFor(() => expect((screen.getByRole('button', { name: /予約をリクエスト/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:/予約をリクエスト/}));
  view.unmount();
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

it('XL-01: 共通予約で前の失敗は新しい送信を解除せず、新しい成功だけ採用する', async () => {
  // 戻って（確認の段を外して）からもう一度確認の段に来た場合。古い失敗は新しい段の送信中を解かない。
  let rejectOld!: (reason: Error) => void;
  let resolveNew!: (value: {booking_id:string;status:string}) => void;
  const old = new Promise<{booking_id:string;status:string}>((_,r)=>{rejectOld=r;});
  const next = new Promise<{booking_id:string;status:string}>(r=>{resolveNew=r;});
  vi.mocked(api.createRequest).mockReturnValueOnce(old).mockReturnValueOnce(next);
  const onSubmitted=vi.fn();
  const first = render(<Confirm menu={menu} staff={staff} slot={slot} autoConfirm={false} onSubmitted={onSubmitted}/>);
  await vi.waitFor(() => expect((screen.getByRole('button', { name: /予約をリクエスト/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:/予約をリクエスト/}));
  first.unmount();
  render(<Confirm menu={menu} staff={staff} slot={slot} autoConfirm={false} onSubmitted={onSubmitted}/>);
  await vi.waitFor(() => expect((screen.getByRole('button', { name: /予約をリクエスト/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:/予約をリクエスト/}));
  await act(async()=>{rejectOld(new Error('古い失敗'));await old.catch(()=>{});});
  expect(screen.getByRole('button',{name:/送信中/}).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByText(/送信に失敗/)).toBeNull();
  await act(async()=>{resolveNew({booking_id:'new',status:'requested'});await next;});
  expect(onSubmitted).toHaveBeenCalledTimes(1);
});

it('XL-01: 共通予約の送信中に登録した戻る処理を呼んだあと古い成功では完了しない', async () => {
  let goBack = () => {};
  let resolve!: (value: {booking_id:string;status:string}) => void;
  const promise = new Promise<{booking_id:string;status:string}>(r => {resolve=r;});
  vi.mocked(api.createRequest).mockReturnValue(promise);
  const onSubmitted=vi.fn(),onBack=vi.fn();
  render(<Confirm menu={menu} staff={staff} slot={slot} autoConfirm={false} onBack={onBack} onRegisterBack={f=>{if(f)goBack=f;}} onSubmitted={onSubmitted}/>);
  await vi.waitFor(() => expect((screen.getByRole('button', { name: /予約をリクエスト/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:/予約をリクエスト/}));
  act(()=>goBack());
  expect(onBack).toHaveBeenCalledTimes(1);
  await act(async () => {resolve({booking_id:'old',status:'confirmed'}); await promise;});
  expect(onSubmitted).not.toHaveBeenCalled();
});
