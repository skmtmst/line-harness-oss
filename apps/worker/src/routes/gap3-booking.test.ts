import {beforeEach,afterEach,test,expect,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner} from '../test-utils/gap1.js';
import {bookingGap3} from './booking-gap3.js';
import booking from './booking.js';
import {depositEstimate} from '../features/booking/booking-deposit.js';
let d:ReturnType<typeof gapFixture>;
beforeEach(()=>{d=gapFixture();d.raw.exec("UPDATE menus SET max_party_size=6,customer_recurring_enabled=1,recurring_freqs_json='[\"weekly\"]',recurring_max_count=12; UPDATE booking_settings SET max_active_bookings_per_friend=52,approval_mode='automatic'; INSERT INTO staff_menus(staff_id,menu_id,is_offered) VALUES('bs2','menu',1)");for(const s of ['bs','bs2'])for(const date of ['2026-11-20','2026-11-27','2026-12-04'])d.raw.prepare("INSERT INTO staff_shifts(id,staff_id,work_date,start_time,end_time) VALUES(?,?,?,'09:00','18:00')").run(s+date,s,date);vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));});
afterEach(()=>{d.raw.close();vi.unstubAllGlobals();});
const app=()=>gapApp(d,[booking,bookingGap3]);
const input={friendId:'f',members:[{menuId:'menu',staffId:'bs'},{menuId:'menu',staffId:'bs2'}],starts_at:'2026-11-20T05:00:00.000Z',startMode:'parallel'};
test('B5-04/06/08/14: 組は別の担当に同時・二重送信でも一組・人ごとに読める',async()=>{
 const r=await gapCall(app(),'/api/booking/admin/groups?account_id=a','POST',input,'group');const body=await r.json() as any;expect(r.status,JSON.stringify(body)).toBe(201);
 expect(body.data.bookings).toHaveLength(2);expect(body.data.total).toBe(16800);expect((await gapCall(app(),'/api/booking/admin/groups?account_id=a','POST',input,'group')).status).toBe(201);
 expect(d.raw.prepare('SELECT count(*) n FROM bookings').get()).toEqual({n:2});expect((await gapCall(app(),`/api/booking/admin/bookings/${body.data.bookings[0].id}/group?account_id=a`)).status).toBe(200);expect(fetch).not.toHaveBeenCalled();
});
test('B5-07: 2人目の競合で1人目も組も残さない',async()=>{
 d.raw.exec("CREATE TRIGGER force_group_conflict BEFORE INSERT ON bookings WHEN NEW.group_index=1 BEGIN SELECT RAISE(ABORT,'CHECK constraint failed: concurrent'); END;");
 const r=await gapCall(app(),'/api/booking/admin/groups?account_id=a','POST',input);expect(r.status).toBe(409);expect(d.raw.prepare('SELECT count(*) n FROM bookings').get()).toEqual({n:0});expect(d.raw.prepare('SELECT count(*) n FROM booking_groups').get()).toEqual({n:0});
});
test('B5-05/15: 同じ担当は続けて、閲覧・代理は作らない',async()=>{
 const r=await gapCall(app(),'/api/booking/admin/groups?account_id=a','POST',{...input,members:[{menuId:'menu',staffId:'bs'},{menuId:'menu',staffId:'bs'}],startMode:'sequential'});expect(r.status,JSON.stringify(await r.clone().json())).toBe(201);
 const data=(await r.json() as any).data;expect(data.bookings[0].ends_at).toBe(data.bookings[1].starts_at);
 for(const [s,im]of [[{...gapOwner,readOnly:true},false],[gapOwner,true]]as const)expect((await gapCall(gapApp(d,[bookingGap3],s,im),'/api/booking/admin/groups?account_id=a','POST',input)).status).toBe(403);
});
test('B1-16: デポジットの条件をすべて満たすと8400の30%=2520、店の時刻で判定・上書きと409',async()=>{
 const b={kind:'percent',value:30,conditions:{always:false,minPeople:2,weekdays:[5],timeBand:'13:00-18:00'},expectedVersion:0};
 expect((await gapCall(app(),'/api/booking/admin/deposit-rules?account_id=a','PUT',b)).status).toBe(200);
 expect((await depositEstimate(d.db,'a','menu',8400,input.starts_at,2)).amount).toBe(2520);expect((await depositEstimate(d.db,'a','menu',8400,input.starts_at,1)).amount).toBe(0);
 expect((await gapCall(app(),'/api/booking/admin/deposit-rules?account_id=a','PUT',b)).status).toBe(409);
 expect((await gapCall(gapApp(d,[bookingGap3],gapOwner,true),'/api/booking/admin/deposit-rules?account_id=a','PUT',b)).status).toBe(403);
});

test('B2-03/B5-14: 券が必須の組は未選択を400で伝え、予約を一部だけ残さない',async()=>{
 d.raw.exec(`INSERT INTO booking_pass_plans(id,line_account_id,kind,name,price,count,valid_days,target_scope_json,allow_without_pass,status,created_by,created_at,idempotency_key,request_json) VALUES('plan','a','ticket','券',1000,5,180,'["menu"]',0,'on_sale','o','now','plan','{}')`);
 const r=await gapCall(app(),'/api/booking/admin/groups?account_id=a','POST',input);expect(r.status).toBe(400);expect(await r.json()).toMatchObject({error:'pass_required'});expect(d.raw.prepare('SELECT count(*) n FROM bookings').get()).toEqual({n:0});
});
