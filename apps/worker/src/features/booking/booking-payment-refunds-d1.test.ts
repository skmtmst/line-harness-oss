import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { BookingPaymentRecord } from '@line-crm/db';
import { simulatePaymentRefund } from './booking-payment-refunds.js';
import { receivePaymentEvent } from './booking-payment-events.js';
let mf:Miniflare,db:D1Database;
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']});
  db=await mf.getD1Database('DB') as unknown as D1Database;
  const sql=readFileSync(new URL('../../../../../packages/db/bootstrap.sql',import.meta.url),'utf8');
  const statements=sql.split('\n').filter(line=>!line.trimStart().startsWith('--')).reduce<string[]>((result,line)=>{
    result[result.length-1]+=`\n${line}`;if(line.trimEnd().endsWith(';'))result.push('');return result;
  },['']).map(s=>s.trim()).filter(Boolean);
  for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50).map(s=>db.prepare(s)));
  await db.batch([
    db.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token) VALUES('a','試験','a','test','test')"),
    db.prepare(`INSERT INTO booking_payments(id,line_account_id,amount,status,provider,provider_payment_id,idempotency_key,created_at,updated_at,paid_at)
      VALUES('p','a',1000,'paid','stripe','pi_test_refund','test','2026-10-16','2026-10-16','2026-10-16')`),
  ]);
},120000);
afterAll(async()=>{vi.unstubAllGlobals();await mf?.dispose();});

it('実D1でも同時返金は残額以内、同じキーは一回、途中失敗は監査も戻し通知累計も二重計上しない',async()=>{
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('外部通信は禁止');}));
  const read=async()=> (await db.prepare("SELECT * FROM booking_payments WHERE id='p'").first<BookingPaymentRecord>())!;
  const initial=await read(),actor={id:'operator',name:'担当'};
  const refund=(key:string,amount:number)=>simulatePaymentRefund(db,initial,{idempotencyKey:key,amount,reason:'一部取消',notifyLine:true},actor);
  await Promise.all([refund('same',300),refund('same',300)]);
  expect(await db.prepare('SELECT COUNT(*) n FROM booking_payment_refunds').first()).toEqual({n:1});
  const results=await Promise.allSettled([refund('a',500),refund('b',500)]);
  expect(results.map(r=>r.status).sort()).toEqual(['fulfilled','rejected']);
  expect((await read()).refunded_amount).toBe(800);
  await db.prepare("CREATE TRIGGER refund_crash BEFORE UPDATE OF refunded_amount ON booking_payments BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
  await expect(refund('last',200)).rejects.toThrow('fixture');
  expect(await db.prepare('SELECT COUNT(*) n FROM booking_payment_refunds').first()).toEqual({n:2});
  expect((await read()).refunded_amount).toBe(800);
  await db.prepare('DROP TRIGGER refund_crash').run();
  expect(await receivePaymentEvent(db,'stripe',{providerPaymentId:'pi_test_refund',providerEventId:'older',status:'refunded',amount:1000,refundedAmount:300,currency:'JPY'},'older'))
    .toMatchObject({status:'duplicate'});
  expect(await receivePaymentEvent(db,'stripe',{providerPaymentId:'pi_test_refund',providerEventId:'full',status:'refunded',amount:1000,refundedAmount:1000,currency:'JPY'},'full'))
    .toMatchObject({status:'refunded'});
  expect(await db.prepare('SELECT SUM(amount) amount FROM booking_payment_refunds').first()).toEqual({amount:1000});
  expect((await read()).status).toBe('refunded');
  expect(fetch).not.toHaveBeenCalled();
},30000);
