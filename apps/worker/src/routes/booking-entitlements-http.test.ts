import {deleteCustomerData} from '../services/customer-data-deletion.js';
import {Hono} from 'hono';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import type { Env } from '../worker-env.js';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';
import {entitlementUseStatement,entitlementMonth} from '../features/booking/booking-entitlements.js';
vi.mock('../services/account-access.js',()=>({canAccessAllLineAccounts:vi.fn(async(_db,_staff,ids:string[])=>ids.every(id=>id==='a'))}));
import {bookingEntitlements} from './booking-entitlements.js';
let f:SqliteD1,readOnly=false,role:'staff'|'owner'='owner',edit=true;
const grant={friendId:'f',kind:'ticket',name:'5回券',remaining:5,validFrom:'2026-01-01T00:00:00Z',expiresAt:'2031-01-01T00:00:00Z',reason:'店頭現金'};
function app(){const a=new Hono<Env>();a.use('*',async(c,next)=>{c.set('staff',{id:'operator',name:'担当',role,readOnly,permissionKeys:edit?['/booking/bookings']:[],viewPermissionKeys:['/booking/bookings']});await next();});a.route('/',bookingEntitlements);return a;}
function req(path='',body?:unknown,key='key',method='POST',account='a'){
 return app().request(`/api/booking/admin/entitlements${path}?account_id=${account}${body===undefined?'&friend_id=f':''}`,body===undefined?{}:{method,headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)},{DB:f.db} as Env['Bindings']);
}
async function issue(extra:Record<string,unknown>={},key='grant'){const r=await req('',{...grant,...extra},key);expect(r.status).toBe(201);return (await r.json<{data:{id:string;version:number}}>()).data;}
function booking(id:string,friend='f',status='requested',at='2030-01-10T01:00:00Z',menu='m'){
 f.raw.prepare(`INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at)
 VALUES(?,'a',?,'s',?,?,datetime(?,'+30 minutes'),datetime(?,'+30 minutes'),?,0,'2026-10-15')`).run(id,friend,menu,at,at,at,status);
}
beforeEach(()=>{f=createTestD1({foreignKeys:true});readOnly=false;role='owner';edit=true;
 f.raw.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token) VALUES('a','店','a','test','test'),('b','他店','b','test','test');
 INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('f','Uf','a','本人'),('other','Uother','a','他人');
 INSERT INTO staff(id,line_account_id,name,display_name) VALUES('s','a','担当','担当');
 INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price,concurrent_capacity) VALUES('m','a','授業',30,1000,100);
 INSERT INTO booking_settings(id,line_account_id,timezone) VALUES('settings','a','Asia/Tokyo');`);
});
afterEach(()=>f.raw.close());
describe('手動回数券・月謝APIと原子的な利用',()=>{
 it('付与・読込・調整・延長・取消と理由/誰がの履歴、再送は一度だけ',async()=>{
  const e=await issue();expect((await req('',grant,'grant')).status).toBe(200);
  expect((await req('',{...grant,remaining:4},'grant')).status).toBe(409);
  const list=await (await req()).json<{data:{remaining:number}[]}>();expect(list.data[0].remaining).toBe(5);
  expect((await req(`/${e.id}/operations`,{action:'adjust',remaining:3,expectedVersion:1,reason:'紙券から移行'},'adjust')).status).toBe(200);
  const extend={action:'extend',expiresAt:'2032-01-01T00:00:00Z',expectedVersion:2,reason:'休講のため延長'};
  expect((await req(`/${e.id}/operations`,extend,'extend')).status).toBe(200);
  expect((await req(`/${e.id}/operations`,extend,'extend')).status).toBe(200);
  expect((await req(`/${e.id}/operations`,{action:'revoke',expectedVersion:3,reason:'誤付与'},'revoke')).status).toBe(200);
  const h=await (await req(`/${e.id}/history`)).json<{data:{actor_id:string;reason:string}[]}>();
  expect(h.data).toHaveLength(4);expect(h.data.every(r=>r.actor_id==='operator'&&!!r.reason)).toBe(true);
 });
 it('古い版・同時更新・閲覧のみ・編集権限なし・別店舗・不正値を拒否',async()=>{
  const e=await issue();const change={action:'adjust',remaining:2,expectedVersion:1,reason:'調整'};
  expect((await Promise.all([req(`/${e.id}/operations`,change,'one'),req(`/${e.id}/operations`,change,'two')])).map(r=>r.status).sort()).toEqual([200,409]);
  for(const bad of [{remaining:-1},{reason:''},{kind:'monthly'},{expiresAt:'invalid'},{friendId:'missing'}])expect((await req('',{...grant,...bad},JSON.stringify(bad))).status).toBeGreaterThanOrEqual(400);
  readOnly=true;expect((await req('',grant,'readonly')).status).toBe(403);expect((await req()).status).toBe(200);
  readOnly=false;role='staff';edit=false;expect((await req('',grant,'noedit')).status).toBe(403);
  role='owner';expect((await req('',grant,'other','POST','b')).status).toBe(404);
 });
 it('確定時だけ減り、二重確定でも1回、残数不足なら確定全体を戻す',async()=>{
  const e=await issue({remaining:1});booking('b1');booking('b2');
  for(const id of ['b1','b2'])await entitlementUseStatement(f.db,id,e.id,'2030-01-10T01:00:00Z','Asia/Tokyo').run();
  expect(f.raw.prepare('SELECT remaining FROM booking_entitlements').get()).toEqual({remaining:1});
  f.raw.exec("UPDATE bookings SET status='confirmed' WHERE id='b1'; UPDATE bookings SET status='confirmed' WHERE id='b1'");
  expect(f.raw.prepare('SELECT remaining FROM booking_entitlements').get()).toEqual({remaining:0});
  expect(()=>f.raw.exec("UPDATE bookings SET status='confirmed' WHERE id='b2'")).toThrow('entitlement_unavailable');
  expect(f.raw.prepare("SELECT status FROM bookings WHERE id='b2'").get()).toEqual({status:'requested'});
  expect(f.raw.prepare("SELECT COUNT(*) n FROM booking_entitlement_events WHERE action='consume'").get()).toEqual({n:1});
 });
 it('即時確定の予約と券の選択も同じbatchで減り、他人・期限・メニュー・取消を検査',async()=>{
  const e=await issue({remaining:2,menuId:'m'});booking('auto','f','confirmed');
  await entitlementUseStatement(f.db,'auto',e.id,'2030-01-10T01:00:00Z','Asia/Tokyo').run();
  expect(f.raw.prepare('SELECT remaining FROM booking_entitlements').get()).toEqual({remaining:1});
  booking('other','other');expect(()=>f.raw.prepare("INSERT INTO booking_entitlement_uses(booking_id,booking_id_history,entitlement_id,period_start,period_end) VALUES('other','other',?,'2030-01-01','2030-02-01')").run(e.id)).toThrow('entitlement_unavailable');
  f.raw.exec("UPDATE booking_entitlements SET status='revoked'");booking('revoked');
  await expect(entitlementUseStatement(f.db,'revoked',e.id,'2030-01-10T01:00:00Z','Asia/Tokyo').run()).rejects.toThrow('entitlement_unavailable');
 });
 it('利用開始前・期限後・対象外メニューの選択はDBでも拒否する',async()=>{
  const e=await issue({menuId:'m'});f.raw.exec("INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('m2','a','別の授業',30,1000)");
  for(const [id,at,menu] of [['early','2025-01-01T01:00:00Z','m'],['late','2032-01-01T01:00:00Z','m'],['menu','2030-01-01T01:00:00Z','m2']]){
   booking(id,'f','requested',at,menu);await expect(entitlementUseStatement(f.db,id,e.id,at,'Asia/Tokyo').run()).rejects.toThrow('entitlement_unavailable');
  }
 });
 it('月謝は店舗時間の予約月で数え、翌月は使え、月跨ぎ変更を黙って消費しない',async()=>{
  const {remaining:_,...monthly}=grant;const r=await req('',{...monthly,kind:'monthly',monthlyLimit:1},'monthly');expect(r.status).toBe(201);
  const e=(await r.json<{data:{id:string}}>()).data;
  for(const [id,at]of [['jan','2030-01-31T14:00:00Z'],['jan2','2030-01-31T14:30:00Z'],['feb','2030-01-31T15:00:00Z']]){
   booking(id,'f','requested',at);await entitlementUseStatement(f.db,id,e.id,at,'Asia/Tokyo').run();
  }
  f.raw.exec("UPDATE bookings SET status='confirmed' WHERE id='jan'");
  expect(()=>f.raw.exec("UPDATE bookings SET status='confirmed' WHERE id='jan2'")).toThrow('entitlement_unavailable');
  f.raw.exec("UPDATE bookings SET status='confirmed' WHERE id='feb'");
  expect(()=>f.raw.exec("UPDATE bookings SET starts_at='2030-02-02T00:00:00Z' WHERE id='jan'")).toThrow('entitlement_month_change');
  const version=(f.raw.prepare('SELECT version FROM booking_entitlements WHERE id=?').get(e.id) as {version:number}).version;
  expect((await req(`/${e.id}/operations`,{action:'adjust',remaining:1,periodAt:'2030-01-15T00:00:00Z',expectedVersion:version,reason:'振替分を付与'},'monthly-adjust')).status).toBe(200);
  f.raw.exec("UPDATE bookings SET status='confirmed' WHERE id='jan2'");
  expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_entitlement_month_limits').get()).toEqual({n:1});
  expect(entitlementMonth('2026-03-15T00:00:00Z','America/New_York')).toEqual({periodStart:'2026-03-01T05:00:00.000Z',periodEnd:'2026-04-01T04:00:00.000Z'});
 });
 it('顧客削除のための匿名化を妨げず、消費/手動操作の履歴を残す',async()=>{
  const e=await issue();booking('anon','f','confirmed');await entitlementUseStatement(f.db,'anon',e.id,'2030-01-10T01:00:00Z','Asia/Tokyo').run();
  await deleteCustomerData({DB:f.db},{kind:'friend_data',id:'f',accountId:'a',friendId:'f',lineUserId:'Uf'},'operator');
  expect(f.raw.prepare('SELECT booking_id,booking_id_history FROM booking_entitlement_uses').get()).toEqual({booking_id:null,booking_id_history:'anon'});
  expect(f.raw.prepare('SELECT friend_id,remaining FROM booking_entitlements').get()).toEqual({friend_id:null,remaining:4});
  expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_entitlement_events').get()).toEqual({n:2});
 });
 it('履歴の保存に失敗したら付与も調整も保存しない',async()=>{
  f.raw.exec("CREATE TRIGGER fail_event BEFORE INSERT ON booking_entitlement_events BEGIN SELECT RAISE(ABORT,'injected'); END;");
  expect((await req('',grant)).status).toBe(503);expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_entitlements').get()).toEqual({n:0});
  f.raw.exec('DROP TRIGGER fail_event');const e=await issue();
  f.raw.exec("CREATE TRIGGER fail_event BEFORE INSERT ON booking_entitlement_events BEGIN SELECT RAISE(ABORT,'injected'); END;");
  expect((await req(`/${e.id}/operations`,{action:'adjust',remaining:0,expectedVersion:1,reason:'失敗の対照'},'fail-adjust')).status).toBe(503);
  expect(f.raw.prepare('SELECT remaining,version FROM booking_entitlements').get()).toEqual({remaining:5,version:1});
 });
});
