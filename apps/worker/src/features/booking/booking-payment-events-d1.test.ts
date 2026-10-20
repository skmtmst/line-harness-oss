import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { processPaymentEvent, receivePaymentEvent } from './booking-payment-events.js';

let mf: Miniflare, db: D1Database;
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']});
  db=await mf.getD1Database('DB') as unknown as D1Database;
  const sql=readFileSync(new URL('../../../../../packages/db/bootstrap.sql',import.meta.url),'utf8');
  const statements=sql.split('\n').filter(line=>!line.trimStart().startsWith('--')).reduce<string[]>((result,line)=>{
    result[result.length-1]+=`\n${line}`;if(line.trimEnd().endsWith(';'))result.push('');return result;
  },['']).map(s=>s.trim()).filter(Boolean);
  for(let i=0;i<statements.length;i+=50) await db.batch(statements.slice(i,i+50).map(s=>db.prepare(s)));
  await db.batch([
    db.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token) VALUES('a','試験','a','test','test')"),
    db.prepare("INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','Uf','a')"),
    db.prepare("INSERT INTO staff(id,line_account_id,name,display_name) VALUES('s','a','担当','担当')"),
    db.prepare("INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('m','a','メニュー',30,1000)"),
    db.prepare(`INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at)
      VALUES('bk','a','f','s','m','2030-01-01T03:00:00Z','2030-01-01T03:30:00Z','2030-01-01T03:30:00Z','requested',1000,'2026-10-16T00:00:00Z')`),
    db.prepare(`INSERT INTO booking_payments(id,line_account_id,booking_id,amount,provider,provider_payment_id,idempotency_key,created_at,updated_at)
      VALUES('p','a','bk',1000,'stripe','pi_test','test','2026-10-16T00:00:00Z','2026-10-16T00:00:00Z')`),
  ]);
},120000);
afterAll(async()=>{await mf?.dispose();});

it('実D1でも通知・支払い・確定監査を原子的に戻し、同時再読込と全額返金を一度だけ反映する',async()=>{
  await db.prepare("CREATE TRIGGER event_fixture_crash BEFORE INSERT ON booking_audit_logs BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
  expect(await receivePaymentEvent(db,'stripe',{providerPaymentId:'pi_test',providerEventId:'evt',status:'paid'},'fixture')).toMatchObject({result:'failed'});
  expect(await db.prepare('SELECT status FROM booking_payments').first()).toEqual({status:'unpaid'});
  expect(await db.prepare('SELECT status FROM bookings').first()).toEqual({status:'requested'});
  await db.prepare('DROP TRIGGER event_fixture_crash').run();
  const event=await db.prepare('SELECT id FROM booking_payment_events').first<{id:string}>();
  const results=await Promise.all(['actor1','actor2'].map(actor=>processPaymentEvent(db,'a',event!.id,actor)));
  expect(results.map(r=>r.status).sort()).toEqual(['busy_or_missing','paid']);
  expect(await db.prepare("SELECT COUNT(*) n FROM booking_audit_logs WHERE action='confirmed'").first()).toEqual({n:1});
  expect(await db.prepare('SELECT COUNT(*) n FROM booking_payment_event_replays').first()).toEqual({n:1});
  expect(await receivePaymentEvent(db,'stripe',{providerPaymentId:'pi_test',providerEventId:'refund',status:'refunded',amount:1000,currency:'JPY'},'refund'))
    .toMatchObject({status:'refunded'});
  expect(await db.prepare('SELECT status FROM booking_payments').first()).toEqual({status:'refunded'});
  expect(await processPaymentEvent(db,'a',event!.id,'actor1')).toMatchObject({status:'duplicate'});
  expect(await db.prepare('SELECT status FROM booking_payments').first()).toEqual({status:'refunded'});
},30000);
