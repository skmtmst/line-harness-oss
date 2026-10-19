import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner,seedGapBooking} from '../test-utils/gap1.js';
import {useSqliteClock} from '../test-utils/sqlite-clock.js';
import {bookingPassNotices} from './booking-pass-notices.js';
import {processPassNotices} from '../features/booking/booking-pass-notices.js';
import {entitlementUseStatement} from '../features/booking/booking-entitlements.js';
let d:ReturnType<typeof gapFixture>;
let now:Date;
beforeEach(()=>{
 now=new Date('2026-10-16T01:00:00Z');d=gapFixture();useSqliteClock(d.raw,()=>now);vi.useFakeTimers();vi.setSystemTime(now);
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));
 d.raw.exec(`INSERT INTO booking_pass_plans(id,line_account_id,kind,name,price,count,valid_days,status,created_by,created_at,idempotency_key,request_json) VALUES('p','a','ticket','ヨガ5回券',5000,5,180,'on_sale','o','2026-10-01','plan','{}');
 INSERT INTO booking_entitlements(id,line_account_id,friend_id,kind,name,remaining,valid_from,expires_at,created_at,updated_at,plan_id)
 VALUES('e','a','f','ticket','ヨガ5回券',2,'2026-10-01T00:00:00Z','2026-10-30T09:00:00Z','2026-10-01','2026-10-01','p');`);
});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();d.raw.close();vi.useRealTimers();vi.unstubAllGlobals();});
const base='/api/booking/admin/pass-plans/p/notice-settings?account_id=a';
const app=(s=gapOwner,im=false)=>gapApp(d,[bookingPassNotices],s,im);
async function enable(remainingOne=true,expiry14Days=true){const r=await gapCall(app(),base,'PUT',{remainingOne,expiry14Days,expectedVersion:1,testMode:true});expect(r.status,await r.clone().text()).toBe(200);}
async function consume(id='bk'){
 seedGapBooking(d,id,'requested','2026-10-20T01:00:00Z');await entitlementUseStatement(d.db,id,'e','2026-10-20T01:00:00Z','Asia/Tokyo').run();
 d.raw.prepare("UPDATE bookings SET status='confirmed' WHERE id=?").run(id);
}
const notices=()=>d.raw.prepare('SELECT kind,status,scheduled_at,purpose,test_mode FROM booking_entitlement_notices ORDER BY kind').all();
test('B2-18/19-DEFAULT: 初期オフ、オンには版と模擬を要求、閲覧のみ/代理/担当外は変更不可',async()=>{
 const r=await gapCall(app(),base);expect((await r.json() as any).data).toMatchObject({remainingOne:false,expiry14Days:false,version:1,deliveryAvailable:false,testMode:true});
 await consume();await processPassNotices(d.db,now,'a');expect(notices()).toEqual([]);
 for(const [staff,im]of [[{...gapOwner,readOnly:true},false],[gapOwner,true],[{...gapOwner,role:'staff' as const,permissionKeys:['/booking/bookings'] as string[]},false]]as const){
  expect((await gapCall(app(staff,im),base)).status).toBe(200);
  expect((await gapCall(app(staff,im),base,'PUT',{remainingOne:true,expiry14Days:true,expectedVersion:1,testMode:true})).status).toBe(403);
  expect((await gapCall(app(staff,im),'/api/booking/admin/pass-notices/simulate?account_id=a','POST',{testMode:true})).status).toBe(403);
 }
 expect((await gapCall(app(),base.replace('account_id=a','account_id=b'))).status).toBe(404);
 expect((await gapCall(app(),base,'PUT',{remainingOne:true,expiry14Days:true,expectedVersion:1})).status).toBe(400);
 await enable();expect((await gapCall(app(),base,'PUT',{remainingOne:false,expiry14Days:false,expectedVersion:1,testMode:true})).status).toBe(409);
 // Enabling does not retroactively fabricate a remaining-one event.
 expect(notices()).toEqual([]);
});
test('B2-18: 申込では知らせ0、確定の減算と同時に1件、取消/再利用でも二重にしない',async()=>{
 await enable(true,false);
 seedGapBooking(d,'bk','requested','2026-10-20T01:00:00Z');await entitlementUseStatement(d.db,'bk','e','2026-10-20T01:00:00Z','Asia/Tokyo').run();expect(notices()).toEqual([]);
 d.raw.exec("UPDATE bookings SET status='confirmed' WHERE id='bk'");expect(notices()).toHaveLength(1);
 await Promise.all([processPassNotices(d.db,now,'a'),processPassNotices(d.db,now,'a')]);expect(notices()).toMatchObject([{kind:'remaining_one',status:'simulated',purpose:'transaction',test_mode:1}]);
 d.raw.exec("UPDATE bookings SET status='cancelled',cancelled_at='2026-10-16T01:00:00Z' WHERE id='bk'");await consume('bk2');await processPassNotices(d.db,now,'a');expect(notices()).toHaveLength(1);
 const r=await gapCall(app(),'/api/booking/admin/pass-notices?account_id=a&planId=p&limit=10');expect((await r.json() as any).data).toMatchObject({total:1,sent:false,testMode:true,items:[{messages:[{type:'text',text:expect.stringContaining('残りは1回')}]}]});
 expect(d.raw.prepare('SELECT count(*) n FROM messages_log').get()).toEqual({n:0});
});
test('B2-18-ATOMIC: 通知の記録に失敗したら確定・残り・消費履歴も全部戻す',async()=>{
 await enable(true,false);d.raw.exec("CREATE TRIGGER fail_notice BEFORE INSERT ON booking_entitlement_notices BEGIN SELECT RAISE(ABORT,'notice_failed'); END;");
 await expect(consume()).rejects.toThrow('notice_failed');
 expect(d.raw.prepare("SELECT status FROM bookings WHERE id='bk'").get()).toEqual({status:'requested'});
 expect(d.raw.prepare("SELECT remaining FROM booking_entitlements WHERE id='e'").get()).toEqual({remaining:2});
 expect(d.raw.prepare("SELECT consumed_at FROM booking_entitlement_uses WHERE booking_id='bk'").get()).toEqual({consumed_at:null});
 expect(d.raw.prepare("SELECT count(*) n FROM booking_entitlement_events WHERE action='consume'").get()).toEqual({n:0});
});
test('B2-19: 14日前の朝8時に1回だけ、13日前/15日前では予定を作らない',async()=>{
 await enable(false,true);
 for(const at of ['2026-10-15T23:00:00Z','2026-10-16T23:00:00Z'])await processPassNotices(d.db,new Date(at),'a');
 // Only October 16 in the store timezone is fourteen days before October 30.
 expect(notices()).toHaveLength(1);expect(notices()).toMatchObject([{kind:'expiry_14_days',status:'simulated',scheduled_at:'2026-10-15T23:00:00.000Z'}]);
 await processPassNotices(d.db,now,'a');expect(notices()).toHaveLength(1);
});
test('B2-18/19-QUIET: 夜の確定は翌朝、朝7時は処理せず8時に模擬。古い知らせは復活しない',async()=>{
 await enable(true,false);now=new Date('2026-10-16T13:00:00Z');await consume();
 await processPassNotices(d.db,now,'a');expect(notices()).toMatchObject([{status:'scheduled',scheduled_at:'2026-10-16T23:00:00.000Z'}]);
 await processPassNotices(d.db,new Date('2026-10-16T22:00:00Z'),'a');expect(notices()).toMatchObject([{status:'scheduled'}]);
 await processPassNotices(d.db,new Date('2026-10-16T23:00:00Z'),'a');expect(notices()).toMatchObject([{status:'simulated'}]);
 d.raw.exec("UPDATE booking_entitlement_notices SET status='scheduled',scheduled_at='2026-10-15T13:00:00Z'");
 await processPassNotices(d.db,new Date('2026-10-17T00:00:00Z'),'a');expect(notices()).toMatchObject([{status:'skipped_late'}]);
});
test('B2-19-TZ: 店の現地日付で14日前、夏時間のある店でも朝8時',async()=>{
 await enable(false,true);d.raw.exec("UPDATE booking_settings SET timezone='America/New_York';UPDATE booking_entitlements SET expires_at='2026-11-10T15:00:00Z'");
 await processPassNotices(d.db,new Date('2026-10-27T11:00:00Z'),'a');expect(notices()).toMatchObject([{status:'scheduled',scheduled_at:'2026-10-27T12:00:00.000Z'}]);
 await processPassNotices(d.db,new Date('2026-10-27T12:00:00Z'),'a');expect(notices()).toMatchObject([{status:'simulated'}]);
});
test.each(['disabled','revoked','blocked','returned','expired','transaction','marketing'] as const)('B2-18-SAFETY: 直前の%sを確認する',async kind=>{
 await enable(true,false);await consume();
 if(kind==='disabled')d.raw.exec('UPDATE booking_pass_plans SET notify_remaining_one=0');
 if(kind==='revoked')d.raw.exec("UPDATE booking_entitlements SET status='revoked'");
 if(kind==='blocked')d.raw.exec('UPDATE friends SET is_following=0');
 if(kind==='returned')d.raw.exec("UPDATE bookings SET status='cancelled',cancelled_at='2026-10-16T01:00:00Z' WHERE id='bk'");
 if(kind==='expired')d.raw.exec("UPDATE booking_entitlements SET expires_at='2026-10-15T00:00:00Z'");
 if(kind==='transaction'||kind==='marketing')d.raw.prepare("INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source) VALUES('a','f',?,'revoked','本人希望','manual')").run(kind);
 await processPassNotices(d.db,now,'a');
 expect(notices()).toMatchObject([{status:kind==='disabled'?'skipped_disabled':kind==='transaction'?'skipped_opted_out':kind==='marketing'?'simulated':'skipped_unavailable'}]);
});
test('B2-19-EXTEND: 期限変更後は古い予定を使わず、新しい期限で1回だけ',async()=>{
 await enable(false,true);await processPassNotices(d.db,new Date('2026-10-15T22:00:00Z'),'a');
 expect(notices()).toMatchObject([{status:'scheduled'}]);d.raw.exec("UPDATE booking_entitlements SET expires_at='2026-11-13T09:00:00Z'");
 await processPassNotices(d.db,new Date('2026-10-15T23:00:00Z'),'a');expect(notices()).toMatchObject([{status:'skipped_unavailable'}]);
 await processPassNotices(d.db,new Date('2026-10-29T23:00:00Z'),'a');expect(notices()).toHaveLength(2);expect(notices().filter((n:any)=>n.status==='simulated')).toHaveLength(1);
});
test('B2-18-EXPIRY-TEXT: 期限延長後の残数通知は現在の期限を使い、実送信をDBでも拒否する',async()=>{
 await enable(true,false);await consume();d.raw.exec("UPDATE booking_entitlements SET expires_at='2026-11-30T09:00:00Z'");
 await processPassNotices(d.db,now,'a');
 const row=d.raw.prepare('SELECT messages_json FROM booking_entitlement_notices').get() as any;
 expect(JSON.parse(row.messages_json)[0].text).toContain('2026-11-30');
 expect(()=>d.raw.exec('UPDATE booking_entitlement_notices SET test_mode=0')).toThrow('CHECK');
});
