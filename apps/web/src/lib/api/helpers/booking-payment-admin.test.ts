import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../api',()=>({fetchApi:vi.fn(),fetchApiBlob:vi.fn(),ApiError:class extends Error {
  constructor(public status:number,message:string,public code?:string){super(message);}
}}));
import { ApiError, fetchApi, fetchApiBlob } from '../../api';
import { bookingPaymentAdminApi as api, isNotReadyError } from './booking-payment-admin';
beforeEach(()=>vi.clearAllMocks());
describe('作業役Dと同じ支払い管理APIの形',()=>{
  it('試験用Stripeの接続・callback・切断を管理セッションのAPIに送る',async()=>{
    await api.authorizeConnection('a /');
    expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/payment-connection/authorize?account_id=a+%2F',{method:'POST',body:'{}'});
    await api.completeConnection('a',{state:'opaque',code:'ac_test'});
    expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/payment-connection/callback?account_id=a',{method:'POST',body:'{"state":"opaque","code":"ac_test"}'});
    await api.completeConnection('a',{state:'opaque',error:'access_denied'});
    expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/payment-connection/callback?account_id=a',{method:'POST',body:'{"state":"opaque","error":"access_denied"}'});
    await api.disconnectConnection('a');
    expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/payment-connection?account_id=a',{method:'DELETE'});
  });
  it('アカウント・検索を符号化して接続・上書き・記録・通知を読む',async()=>{
    await api.connection('a /');expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/payment-connection?account_id=a+%2F');
    await api.menuOverrides('a');expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/menu-payments?account_id=a');
    await api.records('a',{q:'山 & 田',status:'paid',method:'online',period:'7d',limit:20,offset:40});
    expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/payments?account_id=a&q=%E5%B1%B1+%26+%E7%94%B0&status=paid&method=online&period=7d&limit=20&offset=40');
    await api.events('a',{result:'failed',period:'7d',limit:20});
    expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/payment-events?account_id=a&result=failed&period=7d&limit=20');
  });
  it('既存の返金・通知再読込のパスとメソッドを保持する',async()=>{
    const input={amount:300,reason:'取消',notifyLine:true,idempotencyKey:'request'};
    await api.refund('p /',input);expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/payments/p%20%2F/refund',{method:'POST',body:JSON.stringify(input)});
    await api.refunds('p /');expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/payments/p%20%2F/refunds');
    await api.linkBooking('p /','b','照合');expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/payments/p%20%2F/booking',{method:'POST',body:JSON.stringify({bookingId:'b',reason:'照合'})});
    await api.replayEvent('a','ev /');expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/payment-events/ev%20%2F/replay?account_id=a',{method:'POST',body:'{}'});
  });
  it('設定の読取で返された版を保存に渡せる',async()=>{
    await api.saveCourseMode('a','m','online',3);
    expect(fetchApi).toHaveBeenLastCalledWith('/api/restaurant-test/menus/m/payment?account_id=a',{method:'PUT',body:'{"mode":"online","expectedVersion":3}'});
    await api.saveEventMode('a','ev',null,4);
    expect(fetchApi).toHaveBeenLastCalledWith('/api/events/admin/events/ev/payment?account_id=a',{method:'PUT',body:'{"mode":null,"expectedVersion":4}'});
    await api.saveEventPrice('a','ev',0,5);
    expect(fetchApi).toHaveBeenLastCalledWith('/api/events/admin/events/ev/price?account_id=a',{method:'PUT',body:'{"unitPrice":0,"expectedVersion":5}'});
  });
  it('コース・クラスの読取/保存はDの型と同じ。上書き解除のnullも送る',async()=>{
    await api.courseMode('a','m /');expect(fetchApi).toHaveBeenLastCalledWith('/api/restaurant-test/menus/m%20%2F/payment?account_id=a');
    await api.saveCourseMode('a','m','customer_choice');expect(fetchApi).toHaveBeenLastCalledWith('/api/restaurant-test/menus/m/payment?account_id=a',{method:'PUT',body:'{"mode":"customer_choice"}'});
    await api.eventMode('a','ev /');expect(fetchApi).toHaveBeenLastCalledWith('/api/events/admin/events/ev%20%2F/payment?account_id=a');
    await api.saveEventMode('a','ev',null);expect(fetchApi).toHaveBeenLastCalledWith('/api/events/admin/events/ev/payment?account_id=a',{method:'PUT',body:'{"mode":null}'});
  });
  it('クラス単価・今日の担当・模擬リンク・CSVを追加し、送信を成功へ変えない',async()=>{
    await api.eventPrice('a','e');expect(fetchApi).toHaveBeenLastCalledWith('/api/events/admin/events/e/price?account_id=a');
    await api.saveEventPrice('a','e',1000);expect(fetchApi).toHaveBeenLastCalledWith('/api/events/admin/events/e/price?account_id=a',{method:'PUT',body:'{"unitPrice":1000}'});
    await api.staffTodayCounts('a');expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/staff/today-counts?account_id=a');
    const payload={success:true,data:{paymentId:'p',checkoutUrl:'test',sent:false,simulation:true}};
    vi.mocked(fetchApi).mockResolvedValueOnce(payload);
    expect(await api.previewPaymentLink('a','p /')).toEqual(payload);
    expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/payments/p%20%2F/send-link?account_id=a',{method:'POST',body:'{"dryRun":true}'});
    await api.exportCsv('a',{method:'online',period:'month'});
    expect(fetchApiBlob).toHaveBeenLastCalledWith('/api/booking/admin/payments/export?account_id=a&method=online&period=month');
  });
  it('承認待ちと障害/権限のエラーを区別して保持する',async()=>{
    expect(isNotReadyError(new ApiError(503,'待ち','payment_events_storage_not_ready'))).toBe(true);
    expect(isNotReadyError(new ApiError(503,'障害','payment_admin_unavailable'))).toBe(false);
    expect(isNotReadyError(new ApiError(403,'権限'))).toBe(false);
    vi.mocked(fetchApi).mockRejectedValueOnce(new ApiError(503,'待ち','event_payment_storage_not_ready'));
    await expect(api.saveEventMode('a','e','online')).rejects.toMatchObject({status:503});
  });
});
