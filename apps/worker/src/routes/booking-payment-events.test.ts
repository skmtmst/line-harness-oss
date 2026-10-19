import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { seedAssignmentFixture } from '../test-utils/assignment-fixture.js';
import { paymentEvent, processPaymentEvent, receivePaymentEvent } from '../features/booking/booking-payment-events.js';
import type { WebhookOutcome } from '../services/payment-providers.js';
import { createStripeTestProvider } from '../services/payment-providers.js';
vi.mock('../services/account-access.js',()=>({canAccessAllLineAccounts:vi.fn(async()=>true)}));
import { bookingPaymentAdmin } from './booking-payment-admin.js';
import { bookingPayments } from './booking-payments.js';

let f: SqliteD1;
let readOnly=false;
const secret='fixture-only-webhook-secret';
function app() {
  const app=new Hono<Env>();
  app.use('*',async(c,next)=>{c.set('staff',{id:'s1',name:'試験',role:'owner',readOnly});await next();});
  app.route('/',bookingPaymentAdmin);app.route('/',bookingPayments);
  return app;
}
function request(path:string,method='GET',body?:unknown) {
  return app().request(path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})},
    {DB:f.db,STRIPE_TEST_WEBHOOK_SECRET:secret} as Env['Bindings']);
}
const path='/api/booking/admin/payment-events?account_id=a';
const replay=(id:string,account='a')=>`/api/booking/admin/payment-events/${id}/replay?account_id=${account}`;
const paid={providerPaymentId:'pi_test_p',providerEventId:'evt_one',status:'paid' as const,amount:1000,currency:'JPY'};
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-16T03:00:00Z'));
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('外部通信は禁止');}));
  f=createTestD1({foreignKeys:true});seedAssignmentFixture(f);readOnly=false;
  f.raw.exec(`INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','Uf','a');
    INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at)
    VALUES('bk','a','f','s1','m','2026-10-20T03:00:00Z','2026-10-20T03:30:00Z','2026-10-20T03:30:00Z','requested',1000,'2026-10-16T03:00:00Z');
    INSERT INTO booking_payments(id,line_account_id,booking_id,amount,provider,provider_payment_id,idempotency_key,created_at,updated_at)
    VALUES('p','a','bk',1000,'stripe','pi_test_p','test','2026-10-16T03:00:00Z','2026-10-16T03:00:00Z');`);
});
afterEach(()=>{f.raw.close();vi.useRealTimers();vi.unstubAllGlobals();});
async function receive(outcome:NonNullable<WebhookOutcome>=paid,body='minimal fixture') {return receivePaymentEvent(f.db,'stripe',outcome,body);}
function saved() {return f.raw.prepare('SELECT * FROM booking_payment_events').get() as {id:string;result:string;attempts:number;version:number};}

describe('支払い通知の保存・原子的な反映・再読込',()=>{
  it('支払いと予約と監査を反映し、重複を1件にまとめる。原文を残さない',async()=>{
    expect(await receive(paid,'customer-secret token signature')).toMatchObject({status:'paid'});
    expect(f.raw.prepare('SELECT status FROM bookings').get()).toEqual({status:'confirmed'});
    expect(f.raw.prepare("SELECT COUNT(*) n FROM booking_audit_logs WHERE action='confirmed'").get()).toEqual({n:1});
    expect(await receive(paid,'customer-secret token signature')).toEqual({status:'duplicate'});
    expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_payment_events').get()).toEqual({n:1});
    expect(await paymentEvent(f.db,'a',saved().id)).toMatchObject({kind:'paid',repeat:true,result:'applied',bookingId:'bk'});
    expect(JSON.stringify(saved())).not.toMatch(/customer-secret|token signature/);
    expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_operation_runs').get()).toEqual({n:1});
    expect(fetch).not.toHaveBeenCalled();
  });
  it('通知IDの使い回しで内容が変わったら元の通知を上書きしない',async()=>{
    await receive();expect(await receive({...paid,amount:999})).toEqual({status:'event_conflict'});
    expect(saved()).toMatchObject({amount:1000,result:'applied',attempts:1});
  });
  it('金額・通貨の不一致を反映せず、画面へ固定の失敗コードを返す',async()=>{
    expect(await receive({...paid,amount:999,currency:'USD'})).toMatchObject({result:'failed'});
    expect(f.raw.prepare('SELECT status FROM booking_payments').get()).toEqual({status:'unpaid'});
    expect(saved()).toMatchObject({result:'failed',error_code:'payment_state_mismatch'});
  });
  it('決済サービスと保存済みの相手IDが違う通知を反映しない',async()=>{
    f.raw.exec("UPDATE booking_payments SET provider='another'");
    expect(await receive()).toEqual({status:'unknown_payment'});
    expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_payment_events').get()).toEqual({n:0});
    f.raw.exec("UPDATE booking_payments SET provider='stripe'");
    await receive({...paid,amount:999});
    f.raw.exec("UPDATE booking_payments SET provider_payment_id='replaced-id'");
    expect(await processPaymentEvent(f.db,'a',saved().id,'s1')).toMatchObject({result:'failed'});
    expect(f.raw.prepare('SELECT status FROM booking_payments').get()).toEqual({status:'unpaid'});
  });
  it('予約監査の保存が失敗したら入金・確定も戻し、理由を無害化して再試行できる',async()=>{
    f.raw.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON booking_audit_logs BEGIN SELECT RAISE(ABORT,'private failure text'); END");
    expect(await receive()).toMatchObject({result:'failed'});
    expect(f.raw.prepare('SELECT status FROM booking_payments').get()).toEqual({status:'unpaid'});
    expect(f.raw.prepare('SELECT status FROM bookings').get()).toEqual({status:'requested'});
    expect(saved()).toMatchObject({result:'failed',error_code:'payment_event_apply_failed',lease_token:null});
    f.raw.exec('DROP TRIGGER fail_audit');
    const response=await request(replay(saved().id),'POST',{});expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({data:{result:'applied',repeat:true}});
    expect(f.raw.prepare('SELECT actor_id,source_version,result FROM booking_payment_event_replays').get()).toEqual({actor_id:'s1',source_version:1,result:'applied'});
    expect(fetch).not.toHaveBeenCalled();
  });
  it('同時再読込は1つだけを受け付け、成功済みの通知では二重に確定しない',async()=>{
    await receive();
    const results=await Promise.all([processPaymentEvent(f.db,'a',saved().id,'s1'),processPaymentEvent(f.db,'a',saved().id,'s2')]);
    expect(results.map(r=>r.status).sort()).toEqual(['busy_or_missing','duplicate']);
    expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_payment_event_replays').get()).toEqual({n:1});
    expect(f.raw.prepare("SELECT COUNT(*) n FROM booking_audit_logs WHERE action='confirmed'").get()).toEqual({n:1});
    expect((await request(replay(saved().id),'POST',{})).status).toBe(200);
    expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_payment_event_replays').get()).toEqual({n:2});
  });
  it('期限切れのleaseは回収し、奪われた古い処理は入金を書き換えない',async()=>{
    f.raw.exec(`INSERT INTO booking_payment_events(id,line_account_id,provider,provider_event_id,payment_id,provider_payment_id,kind,outcome,amount,currency,received_at,lease_token,lease_until)
      VALUES('evt','a','stripe','evt','p','pi_test_p','paid','paid',1000,'JPY','2026-10-16T00:00:00Z','old','2026-10-15T00:00:00Z')`);
    const batch=f.db.batch.bind(f.db);
    vi.spyOn(f.db,'batch').mockImplementationOnce(async statements=>{
      f.raw.exec("UPDATE booking_payment_events SET lease_token='new-owner',lease_until='2026-10-17T00:00:00Z'");
      return batch(statements);
    });
    expect(await processPaymentEvent(f.db,'a','evt','s1')).toEqual({status:'busy_or_missing'});
    expect(f.raw.prepare('SELECT status FROM booking_payments').get()).toEqual({status:'unpaid'});
    expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_payment_event_replays').get()).toEqual({n:0});
    vi.restoreAllMocks();
    f.raw.exec("UPDATE booking_payment_events SET lease_until='2026-10-15T00:00:00Z'");
    expect(await processPaymentEvent(f.db,'a','evt','s1')).toMatchObject({status:'paid'});
  });
  it('通知一覧は店・期間・結果で絞り、再読込は閲覧のみ403・別店404',async()=>{
    await receive();const id=saved().id;
    expect(await (await request(path+'&result=applied&limit=1')).json()).toMatchObject({data:{total:1,items:[{id,result:'applied'}]}});
    expect(await (await request(path+'&result=failed')).json()).toMatchObject({data:{total:0,items:[]}});
    expect(await (await request(path.replace('account_id=a','account_id=b'))).json()).toMatchObject({data:{total:0}});
    expect((await request(replay(id,'b'),'POST',{})).status).toBe(404);
    readOnly=true;expect((await request(replay(id),'POST',{})).status).toBe(403);readOnly=false;
    for(const query of ['result=bad','period=month','limit=0','limit=101','limit=1.1']) expect((await request(path+'&'+query)).status).toBe(400);
    f.raw.exec("UPDATE booking_payment_events SET received_at='2026-06-01T00:00:00Z'");
    expect(await (await request(path)).json()).toMatchObject({data:{total:0}});
  });
  it('全額返金は1回だけ記録し、遅れた入金通知は返金を取り消さない',async()=>{
    await receive();
    expect(await receive({...paid,status:'refunded',providerEventId:'evt_refund'})).toMatchObject({status:'refunded'});
    expect(f.raw.prepare('SELECT status,refunded_at FROM booking_payments').get()).toEqual({status:'refunded',refunded_at:'2026-10-16T03:00:00.000Z'});
    expect(await receive({...paid,providerEventId:'evt_late'})).toMatchObject({status:'duplicate'});
    expect(f.raw.prepare('SELECT status FROM booking_payments').get()).toEqual({status:'refunded'});
  });
  it('支払い失敗を正常な反映と区別し、期限切れ通知は枠を解放する',async()=>{
    expect(await receive({...paid,status:'failed'})).toMatchObject({status:'failed',result:'applied'});
    expect(await paymentEvent(f.db,'a',saved().id)).toMatchObject({kind:'other',note:'payment_failed',result:'applied'});
    f.raw.exec("UPDATE booking_payments SET status='unpaid'; DELETE FROM booking_payment_events");
    expect(await receive({...paid,status:'expired'})).toMatchObject({status:'expired'});
    expect(f.raw.prepare('SELECT status FROM bookings').get()).toEqual({status:'expired'});
    expect(f.raw.prepare('SELECT action FROM booking_audit_logs').get()).toEqual({action:'expired'});
  });
});

describe('署名済みStripe試験通知の入口',()=>{
  async function send(event:unknown,valid=true) {
    const body=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000);
    const signature=createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');
    return app().request('/api/booking/payments/webhook/stripe',{method:'POST',body,
      headers:{'stripe-signature':valid?`t=${timestamp},v1=${signature}`:'bad'}},{DB:f.db,STRIPE_TEST_WEBHOOK_SECRET:secret} as Env['Bindings']);
  }
  it('不正署名と本番通知を拒否し、検証済みデータだけ履歴に入れる',async()=>{
    const event={id:'evt_signed',type:'payment_intent.payment_failed',livemode:false,data:{object:{id:'pi_test_p',amount:1000,currency:'jpy',customer:'secret-customer'}}};
    expect((await send(event,false)).status).toBe(401);
    expect((await send({...event,livemode:true})).status).toBe(401);
    expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_payment_events').get()).toEqual({n:0});
    const response=await send(event);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({status:'failed'});
    expect(JSON.stringify(saved())).not.toContain('secret-customer');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('charge.succeededから署名済みの領収書だけを保存し、入金・確定を重ねない',async()=>{
    await receive();
    const event={id:'evt_receipt',type:'charge.succeeded',livemode:false,data:{object:{id:'ch_test',payment_intent:'pi_test_p',
      amount:1000,currency:'jpy',receipt_url:'https://pay.stripe.com/receipts/test'}}};
    expect((await send(event)).status).toBe(200);
    expect(f.raw.prepare('SELECT receipt_url FROM booking_payments').get()).toEqual({receipt_url:event.data.object.receipt_url});
    expect(f.raw.prepare("SELECT COUNT(*) n FROM booking_audit_logs WHERE action='confirmed'").get()).toEqual({n:1});
    event.id='evt_bad_receipt';event.data.object.receipt_url='https://pay.stripe.com.evil.test/secret';
    expect((await send(event)).status).toBe(200);
    expect(f.raw.prepare('SELECT receipt_url FROM booking_payments').get()).toEqual({receipt_url:'https://pay.stripe.com/receipts/test'});
  });
  it('部分返金の累計額と全額返金の累計額を区別して受け付ける',async()=>{
    const event={id:'evt_refund',type:'charge.refunded',data:{object:{id:'ch_test',payment_intent:'pi_test_p',amount:1000,amount_refunded:500,currency:'jpy'}}};
    f.raw.exec("UPDATE booking_payments SET status='paid'");
    expect((await send(event)).status).toBe(200);
    expect(f.raw.prepare('SELECT status,refunded_amount FROM booking_payments').get()).toEqual({status:'paid',refunded_amount:500});
    event.data.object.amount_refunded=1000;
    const body=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000),signature=createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');
    expect(await createStripeTestProvider({webhookSecret:secret}).verifyWebhook(body,`t=${timestamp},v1=${signature}`)).toMatchObject({status:'refunded',providerPaymentId:'pi_test_p',amount:1000});
  });
});
