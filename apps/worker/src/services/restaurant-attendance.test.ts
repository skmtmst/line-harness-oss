import {beforeEach,afterEach,it,expect} from 'vitest';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';
import {setRestaurantAttendance} from './restaurant-attendance.js';
import {openSeatTables} from './restaurant-closures.js';
import {deliverRestaurantEvent,type RestaurantEvent} from './restaurant-events.js';
import {restaurantRotation} from './restaurant-rotation.js';
let f:SqliteD1;
const start=new Date(Date.now()+5*3600000).toISOString(),end=new Date(Date.now()+7*3600000).toISOString();
const reserve=(id:string,count=2,table='t1')=>f.raw.prepare(`INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,table_id,status) VALUES(?,'s','phone','架空客',?,?,?,?,'confirmed')`).run(id,count,start,end,table);
const action=(action:'visited'|'depart'|'undo_departure'|'undo_visit',expectedVersion:number,requestId=action)=>setRestaurantAttendance(f.db,'r','s',{action,expectedVersion,requestId},'staff','担当');
beforeEach(()=>{f=createTestD1();f.raw.exec(`INSERT INTO rt_organizations(id,account_id,name) VALUES('o','a','組織');INSERT INTO rt_stores(id,organization_id,name,code) VALUES('s','o','店','S');INSERT INTO rt_tables(id,store_id,code,label,min_capacity,max_capacity,seat_type,join_group) VALUES('t1','s','1','1',1,2,'table','A'),('t2','s','2','2',1,2,'table','A');`);});
afterEach(()=>f.raw.close());
it('来店・退店の再送は一度。古い版は拒否し、予定終了を保持して結合卓全体を解放',async()=>{
 f.raw.prepare("INSERT INTO rt_inventory_slots(id,store_id,starts_at,total_capacity) VALUES('slot','s',?,8)").run(start);
 reserve('r',4);await action('visited',1);await action('visited',1);
 expect(f.raw.prepare("SELECT reserved_count FROM rt_inventory_slots WHERE id='slot'").get()).toEqual({reserved_count:4});await expect(action('depart',1)).rejects.toMatchObject({status:409});
 expect(await openSeatTables(f.db,'s',start,end,2)).toEqual([]);
 await action('depart',2);await action('depart',2);
 expect(f.raw.prepare("SELECT reserved_count FROM rt_inventory_slots WHERE id='slot'").get()).toEqual({reserved_count:0});
 expect((await openSeatTables(f.db,'s',start,end,4))[0].tableIds).toEqual(['t1','t2']);
 expect(f.raw.prepare("SELECT ends_at,customer_version FROM rt_reservations WHERE id='r'").get()).toEqual({ends_at:end,customer_version:3});
 expect(f.raw.prepare('SELECT COUNT(*) n FROM rt_reservation_departures').get()).toEqual({n:1});
 expect(f.raw.prepare("SELECT event_type FROM rt_reservation_events ORDER BY reservation_version").all()).toEqual([{event_type:'restaurant.reservation.created'},{event_type:'restaurant.arrived'},{event_type:'restaurant.departed'}]);
});
it('退店訂正と次の予約が競っても片方だけ。敗者の監査・予約・占有は変わらない',async()=>{
 reserve('r',4);await action('visited',1);await action('depart',2);reserve('next',2,'t2');
 await expect(action('undo_departure',3)).rejects.toThrow(/table_conflict/);
 expect(f.raw.prepare('SELECT undone_at FROM rt_reservation_departures').get()).toEqual({undone_at:null});
 f.raw.exec("UPDATE rt_reservations SET status='cancelled' WHERE id='next'");await action('undo_departure',3);expect(()=>reserve('third')).toThrow(/table_conflict/);
});
it('待ちの招待も退店で空いた結合卓を占有し、訂正の割込みを拒否する',async()=>{
 reserve('r',4);await action('visited',1);await action('depart',2);
 f.raw.prepare(`INSERT INTO rt_seat_waitlist(id,store_id,starts_at,ends_at,guest_count,customer_name,identity_key,status,table_id,hold_expires_at) VALUES('w','s',?,?,4,'待ち','w','invited','t1',?)`).run(start,end,new Date(Date.now()+1800000).toISOString());
 await expect(action('undo_departure',3)).rejects.toThrow(/table_conflict/);expect(()=>reserve('other',2,'t2')).toThrow(/table_conflict/);
});
it('過去の予定から実来店を補充しない。退店後の来店取消は禁止する',async()=>{
 reserve('r');f.raw.exec("UPDATE rt_reservations SET status='visited' WHERE id='r'");await expect(action('depart',2)).rejects.toThrow(/departure_requires_visit/);
 f.raw.exec("UPDATE rt_reservations SET status='confirmed' WHERE id='r'");await action('visited',3);await action('depart',4);await expect(action('undo_visit',5)).rejects.toMatchObject({status:409});
});
it('ポイント加算後に失敗してもSQLの完了工程を再利用し、受取先別の完了を保つ',async()=>{
 reserve('r');const event=f.raw.prepare('SELECT * FROM rt_reservation_events LIMIT 1').get() as RestaurantEvent;
 f.raw.exec('CREATE TABLE test_effect(id TEXT PRIMARY KEY,n INTEGER);INSERT INTO test_effect VALUES(\'one\',0)');
 let fail=true;
 const consumer=async(db:D1Database)=>{await db.prepare("UPDATE test_effect SET n=n+1 WHERE id='one'").run();if(fail)throw new Error('deliberate_failure');await db.prepare("INSERT INTO test_effect VALUES('two',1)").run();};
 expect(await deliverRestaurantEvent(f.db,event,'mileage',consumer)).toBe(false);fail=false;
 expect(await deliverRestaurantEvent(f.db,event,'mileage',consumer)).toBe(true);expect(await deliverRestaurantEvent(f.db,event,'mileage',consumer)).toBe(true);
 expect(f.raw.prepare('SELECT * FROM test_effect ORDER BY id').all()).toEqual([{id:'one',n:1},{id:'two',n:1}]);
 expect(f.raw.prepare("SELECT status FROM rt_reservation_event_receipts WHERE consumer_key='event_bus'").get()).toEqual({status:'pending'});
});
it('滞在は実測のみ、回転は退店組数÷営業する卓数。営業時間なしは推測せずnull',async()=>{
 reserve('r');const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date());
 expect((await restaurantRotation(f.db,'s',date)).turnover).toBeNull();
 f.raw.prepare("INSERT INTO rt_opening_hours_settings(store_id,hours_json,updated_by) VALUES('s',?,'staff')").run(JSON.stringify([{weekday:new Date(date+'T00:00:00Z').getUTCDay(),periods:[{opensAt:'00:00',closesAt:'24:00'}]}]));
 await action('visited',1);await action('depart',2);const value=await restaurantRotation(f.db,'s',date);
 expect(value.turnover).toBe(.5);expect(value.averageStayMinutes).toBeGreaterThanOrEqual(0);expect(value.utilization).not.toBeNull();
});

it('退店の訂正は結合卓の片方の停止も拒否する',async()=>{
 reserve('r',4);await action('visited',1);await action('depart',2);f.raw.exec("UPDATE rt_tables SET is_active=0 WHERE id='t2'");await expect(action('undo_departure',3)).rejects.toThrow(/table_conflict/);expect(f.raw.prepare('SELECT undone_at FROM rt_reservation_departures').get()).toEqual({undone_at:null});
});

it('退店を戻す時もLINE在庫と人数を検査する',async()=>{
 f.raw.prepare("INSERT INTO rt_inventory_slots(id,store_id,starts_at,total_capacity,line_capacity) VALUES('slot','s',?,8,2)").run(start);
 reserve('r');f.raw.exec("UPDATE rt_reservations SET source='line',customer_request_id='request' WHERE id='r'");await action('visited',1);await action('depart',2);
 f.raw.exec("UPDATE rt_inventory_slots SET line_capacity=1 WHERE id='slot'");
 await expect(action('undo_departure',3)).rejects.toThrow(/customer_line_capacity/);
 expect(f.raw.prepare("SELECT reserved_count FROM rt_inventory_slots WHERE id='slot'").get()).toEqual({reserved_count:0});
});
it('日をまたぐ結合卓の稼働は営業時間・卓別休業で切り分け、退店した日に1組として数える',async()=>{
 f.raw.exec("INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,table_id,status) VALUES('r','s','phone','架空客',4,'2026-10-09T13:00:00Z','2026-10-09T16:00:00Z','t1','confirmed')");
 await action('visited',1);f.raw.exec("UPDATE rt_seat_visit_marks SET marked_at='2026-10-09T13:00:00Z' WHERE reservation_id='r'");await action('depart',2);
 f.raw.exec("UPDATE rt_reservations SET departed_at='2026-10-09T16:00:00Z' WHERE id='r'");
 f.raw.prepare("INSERT INTO rt_opening_hours_settings(store_id,hours_json,updated_by) VALUES('s',?,'staff')").run(JSON.stringify([{weekday:5,periods:[{opensAt:'17:00',closesAt:'24:00'}]},{weekday:6,periods:[{opensAt:'00:00',closesAt:'02:00'}]}]));
 f.raw.prepare("INSERT INTO rt_closures(id,store_id,start_date,end_date,all_day,start_time,end_time,kind,table_ids_json,periods_json,created_by) VALUES('closed','s','2026-10-09','2026-10-09',0,'22:30','23:30','temporary_closed','[\"t2\"]',?,'staff')").run(JSON.stringify([{startsAt:'2026-10-09T13:30:00Z',endsAt:'2026-10-09T14:30:00Z'}]));
 const before=await restaurantRotation(f.db,'s','2026-10-09'),after=await restaurantRotation(f.db,'s','2026-10-10');
 expect(before.departedGroups).toBe(0);expect(before.utilization).toBeCloseTo(3/13);
 expect(after.departedGroups).toBe(1);expect(after.turnover).toBe(.5);expect(after.averageStayMinutes).toBe(180);expect(after.utilization).toBe(.5);
});
