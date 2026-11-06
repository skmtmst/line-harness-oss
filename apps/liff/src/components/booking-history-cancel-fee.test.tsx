// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BookingCancellationReview, BookingHistoryItem } from '@line-crm/shared';
import Dialog from './booking-history-cancel-dialog.js';
const calls=vi.hoisted(()=>({quote:vi.fn()}));
vi.mock('../lib/api.js',()=>({api:{cancellationQuote:calls.quote}}));
const quote:BookingCancellationReview={feeNow:4200,feeNoShow:8400,freeUntil:'2099-10-01T04:00:00Z',text:'決まり',policyAcceptedRequired:true,canCancel:true,lockVersion:4,cancelDeadlineAt:'2099-10-02T04:00:00Z'};
const booking:BookingHistoryItem={id:'bk',menu_id:'menu',staff_id:'staff',menu_name:'予約メニュー',staff_name:'担当者',profile_image_url:null,starts_at:quote.cancelDeadlineAt,status:'confirmed',lock_version:4,cancellationQuote:quote};
const props={booking,payment:null,busy:false,error:null,onCancel:vi.fn()};
beforeEach(()=>{calls.quote.mockReset().mockResolvedValue(quote)});
afterEach(cleanup);
it('最新の金額を表示し、チェックするまで取消を送らない',async()=>{
 const confirm=vi.fn();render(<Dialog {...props} onConfirm={confirm}/>);
 const button=screen.getByRole('button',{name:'キャンセルする'}) as HTMLButtonElement;
 expect(button.disabled).toBe(true);
 await screen.findByText('今取り消すとキャンセル料 ¥4,200 が掛かります');
 expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
 fireEvent.click(button);expect(confirm).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(button);
 expect(confirm).toHaveBeenCalledWith({feeAccepted:true,expectedFeeAmount:4200},quote.cancelDeadlineAt);
});
it('料金が無料の間は金額の同意を要求せず、無料の期限を示す',async()=>{
 calls.quote.mockResolvedValue({...quote,feeNow:0});const confirm=vi.fn();render(<Dialog {...props} onConfirm={confirm}/>);
 await screen.findByText('今なら無料で取り消せます');expect(screen.queryByRole('checkbox')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'キャンセルする'}));expect(confirm).toHaveBeenCalledWith(undefined,quote.cancelDeadlineAt);
});
it('読めなかった金額を無料扱いせず、再読取で戻る',async()=>{
 calls.quote.mockRejectedValueOnce(new Error('offline'));const confirm=vi.fn();render(<Dialog {...props} onConfirm={confirm}/>);
 await screen.findByText('キャンセル料を確認できませんでした。');fireEvent.click(screen.getByRole('button',{name:'キャンセルする'}));expect(confirm).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'もう一度読み込む'}));await screen.findByText('今取り消すとキャンセル料 ¥4,200 が掛かります');
 expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});
it('再確認で金額が変わったら、前の同意を使い回さない',async()=>{
 const confirm=vi.fn();const view=render(<Dialog {...props} onConfirm={confirm}/>);
 await screen.findByRole('checkbox');fireEvent.click(screen.getByRole('checkbox'));calls.quote.mockResolvedValue({...quote,feeNow:8400});
 view.rerender(<Dialog {...props} refreshKey={1} onConfirm={confirm}/>);
 expect((screen.getByRole('button',{name:'キャンセルする'}) as HTMLButtonElement).disabled).toBe(true);
 await screen.findByText('今取り消すとキャンセル料 ¥8,400 が掛かります');expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'キャンセルする'}));expect(confirm).toHaveBeenCalledWith({feeAccepted:true,expectedFeeAmount:8400},quote.cancelDeadlineAt);
});
it.each([{canCancel:false},{lockVersion:5}])('期限や版が変わったときは送らず、一覧の再読取を案内する %j',async value=>{
 calls.quote.mockResolvedValue({...quote,...value});const confirm=vi.fn(),reload=vi.fn();render(<Dialog {...props} onConfirm={confirm} onReload={reload}/>);
 await screen.findByText('予約の内容や期限が変わっています。予約を読み直してください。');fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'キャンセルする'}));expect(confirm).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'予約を読み直す'}));expect(reload).toHaveBeenCalledOnce();
});
it('別の予約を開いた後に遅れて届く見積もりを表示しない',async()=>{
 let resolve!:(value:BookingCancellationReview)=>void;calls.quote.mockReturnValueOnce(new Promise<BookingCancellationReview>(done=>{resolve=done}));
 const view=render(<Dialog {...props} onConfirm={vi.fn()}/>);await waitFor(()=>expect(calls.quote).toHaveBeenCalledTimes(1));
 calls.quote.mockResolvedValue({...quote,feeNow:100});view.rerender(<Dialog {...props} booking={{...booking,id:'other'}} onConfirm={vi.fn()}/>);
 await screen.findByText('今取り消すとキャンセル料 ¥100 が掛かります');resolve({...quote,feeNow:999});await waitFor(()=>expect(screen.queryByText(/¥999/)).toBeNull());
});
