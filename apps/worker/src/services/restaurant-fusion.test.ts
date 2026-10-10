import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';
import {openSeatTables} from './restaurant-closures.js';
import {saveRestaurantFloor,validRestaurantFloor} from './restaurant-floor.js';
import {floorBoxesOverlap,floorBoxInside,peopleBoardEntry,seatBoardEntry,reservationOccupies,type RestaurantFloorWrite} from '@line-crm/shared';
let test:SqliteD1;
const start='2027-10-01T09:00:00Z',end='2027-10-01T11:00:00Z';
function reserve(id:string,table='t1',count=2,starts=start,ends=end,status='confirmed'){
 test.raw.prepare(`INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,table_id,status) VALUES(?,'s','phone','お客さま',?,?,?,?,?)`).run(id,count,starts,ends,table,status);
}
beforeEach(()=>{test=createTestD1();test.raw.exec(`INSERT INTO rt_organizations(id,account_id,name) VALUES('o','a','組織');
 INSERT INTO rt_stores(id,organization_id,name,code) VALUES('s','o','店舗','S');
 UPDATE rt_floors SET id='f' WHERE store_id='s';
 INSERT INTO rt_tables(id,store_id,code,label,min_capacity,max_capacity,seat_type,join_group,floor_id) VALUES
 ('t1','s','T1','T1',1,2,'table','A','f'),('t2','s','T2','T2',1,2,'table','A','f');`);});
afterEach(()=>test.raw.close());
describe('飲食1・既存保存先の共通契約',()=>{
 it('旧SQLite時刻はUTCとして返し、人の最初の版0を維持する',()=>{
  const seat=seatBoardEntry({id:'old',starts_at:'2026-10-02 10:00:00',ends_at:'2026-10-02 12:00:00'});expect(seat.startsAt).toBe('2026-10-02T10:00:00Z');expect(seat.endsAt).toBe('2026-10-02T12:00:00Z');
  expect(peopleBoardEntry({id:'old-person',lock_version:0}).version).toBe(0);
 });
 it('電話同士も最後の1卓を二重確保できず、隣接する予約は入る',()=>{
 reserve('r1');expect(()=>reserve('r2')).toThrow(/table_conflict/);
 reserve('r3','t1',2,end,'2027-10-01T13:00:00Z');
 expect(test.raw.prepare('SELECT COUNT(*) n FROM rt_reservations').get()).toEqual({n:2});
 });
 it('結合卓の両方を占有し、一部への受付を拒否して在庫で全卓を数える',()=>{
 reserve('joined','t1',4);
 expect(test.raw.prepare('SELECT table_id FROM rt_reservation_table_links ORDER BY table_id').all()).toEqual([{table_id:'t1'},{table_id:'t2'}]);
 expect(()=>reserve('other','t2')).toThrow(/table_conflict/);
 test.raw.exec(`INSERT INTO rt_inventory_slots(id,store_id,starts_at,slot_minutes,total_capacity,line_capacity) VALUES('i','s','${start}',30,4,4)`);
 expect(test.raw.prepare('SELECT occupied_seats FROM rt_inventory_occupancy').get()).toEqual({occupied_seats:4});
 });
 it('版違いの変更は0件で、移動失敗でも元予約・両卓を保つ',()=>{
 reserve('r');test.raw.exec("UPDATE rt_reservations SET note='変更' WHERE id='r'");
 expect(test.raw.prepare('SELECT customer_version FROM rt_reservations').get()).toEqual({customer_version:2});
 expect(test.raw.prepare("UPDATE rt_reservations SET table_id='t2' WHERE id='r' AND customer_version=1").run().changes).toBe(0);
 reserve('other','t2');expect(()=>test.raw.exec("UPDATE rt_reservations SET table_id='t2' WHERE id='r' AND customer_version=2")).toThrow(/table_conflict/);
 expect(test.raw.prepare("SELECT table_id FROM rt_reservations WHERE id='r'").get()).toEqual({table_id:'t1'});
 });
 it('来店だけでは卓を解放せず、取消・期限切れは空く',()=>{
 reserve('r','t1',2,start,end,'visited');expect(()=>reserve('other')).toThrow(/table_conflict/);
 test.raw.exec("UPDATE rt_reservations SET status='cancelled' WHERE id='r'");reserve('other');
 expect(reservationOccupies('visited',null)).toBe(true);expect(reservationOccupies('pending','2020-01-01T00:00:00Z')).toBe(false);
 });
 it('つないだ卓の片方の停止・閉鎖を追い越さない',()=>{
 test.raw.exec("UPDATE rt_tables SET is_active=0 WHERE id='t2'");expect(()=>reserve('joined','t1',4)).toThrow(/table_conflict/);
 });
 it('未連携客の注意も予約に保存し、固定欄の定義を保護する',()=>{
 reserve('r');test.raw.exec("UPDATE rt_reservations SET allergy_note='乳' WHERE id='r'");
 const r=test.raw.prepare("SELECT * FROM rt_reservations WHERE id='r'").get() as Record<string,unknown>;
 expect(seatBoardEntry(r).dining?.allergy).toBeNull(); // 予約時の写しは後から上書きしない
 expect(()=>test.raw.exec("UPDATE friend_fields SET name='別名' WHERE id='fixed-allergy'")).toThrow(/IMMUTABLE/);
 expect(test.raw.prepare('SELECT COUNT(*) n FROM friend_fixed_fields').get()).toEqual({n:10});
 });
 it('招待中の待ちも結合した全卓を押さえ、期限切れで候補へ戻る',async()=>{
  test.raw.exec(`INSERT INTO rt_seat_waitlist(id,store_id,starts_at,ends_at,guest_count,customer_name,identity_key,status,table_id,hold_expires_at) VALUES('w','s','${start}','${end}',4,'待ち','w','invited','t1','2027-09-01T00:00:00Z')`);
  expect(test.raw.prepare('SELECT table_id FROM rt_seat_waitlist_table_links ORDER BY table_id').all()).toEqual([{table_id:'t1'},{table_id:'t2'}]);
  expect(await openSeatTables(test.db,'s',start,end,2)).toEqual([]);
  expect(()=>reserve('secondary','t2')).toThrow(/table_conflict/);
  test.raw.exec("UPDATE rt_seat_waitlist SET hold_expires_at='2020-01-01T00:00:00Z' WHERE id='w'");
  expect((await openSeatTables(test.db,'s',start,end,4))[0].tableIds).toEqual(['t1','t2']);
 });
 it('注意の写しは店の友だちだけから作り、後から欄やコースを変えても保つ',()=>{
  test.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','店','t','s'),('b','d','別店','t','s');
   UPDATE rt_stores SET line_account_id='a' WHERE id='s';
   INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('fa','UID','a','友だち'),('fb','UID-B','b','別店');
   INSERT INTO friend_field_values(friend_id,field_id,value) VALUES('fa','fixed-allergy','乳'),('fa','fixed-anniversary','2026-10-10'),('fa','fixed-seat_preference','窓側'),('fb','fixed-allergy','別店の値');
   INSERT INTO rt_menu_items(id,store_id,kind,name,price,allergens_json) VALUES('m','s','course','コース',8800,'["小麦"]');
   INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,table_id,status,line_uid,course_id) VALUES('r','s','line','お客さま',2,'${start}','${end}','t1','confirmed','UID','m');`);
  test.raw.exec(`INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,status,line_uid) VALUES('wrong','s','line','別店のUID',2,'${start}','${end}','confirmed','UID-B')`);
  expect(seatBoardEntry(test.raw.prepare("SELECT * FROM rt_reservations WHERE id='wrong'").get() as Record<string,unknown>).dining?.allergy).toBeNull();
  const read=()=>seatBoardEntry(test.raw.prepare("SELECT * FROM rt_reservations WHERE id='r'").get() as Record<string,unknown>).dining;
  expect(read()).toMatchObject({allergy:'乳',anniversary:'2026-10-10',seatPreference:'窓側',courseAllergens:['小麦']});
  test.raw.exec("UPDATE friend_field_values SET value='後の値' WHERE friend_id='fa'; UPDATE rt_menu_items SET allergens_json='[]' WHERE id='m'");
  expect(read()).toMatchObject({allergy:'乳',seatPreference:'窓側',courseAllergens:['小麦']});
 });
 it('注意と来店の改版で通知を失わず、日時変更は古い通知を無効にする',()=>{
  reserve('r');test.raw.exec("INSERT INTO rt_customer_notice_outbox(id,store_id,reservation_id,customer_version,line_uid,message,retry_key) VALUES('n','s','r',1,'UID','確定','key')");
  test.raw.exec("UPDATE rt_reservations SET note='補足',status='visited' WHERE id='r'");
  expect(test.raw.prepare("SELECT valid FROM rt_customer_notice_outbox WHERE id='n'").get()).toEqual({valid:1});
  test.raw.exec("UPDATE rt_reservations SET starts_at='2027-10-02T09:00:00Z',ends_at='2027-10-02T11:00:00Z' WHERE id='r'");
  expect(test.raw.prepare("SELECT valid FROM rt_customer_notice_outbox WHERE id='n'").get()).toEqual({valid:0});
 });
 it('回転した卓の衝突・はみ出しを拒み、離れた卓や接する卓は許す',()=>{
  const a={x:10,y:10,width:80,height:20,rotation:45};
  expect(floorBoxInside(a,100,100)).toBe(false);
  expect(floorBoxesOverlap({...a,x:100,y:100},{x:135,y:85,width:20,height:80})).toBe(true);
  expect(floorBoxesOverlap({...a,x:100,y:100},{x:300,y:300,width:20,height:80})).toBe(false);
  expect(floorBoxesOverlap({x:0,y:0,width:20,height:20},{x:20,y:0,width:20,height:20})).toBe(false);
 });
 it('図面を同時保存すると古い版だけ失敗し、古い配置を上書きしない',async()=>{
 const f:RestaurantFloorWrite={id:'f',storeId:'s',name:'1階',width:1000,height:700,expectedVersion:1,outline:[],fixtures:[],tables:[{id:'t1',x:100,y:100,width:80,height:64,rotation:0,shape:'rectangle'},{id:'t2',x:250,y:100,width:80,height:64,rotation:0,shape:'rectangle'}]};
 expect(validRestaurantFloor(f)).toBe(true);expect(await saveRestaurantFloor(test.db,f)).toBe(true);
 expect(await saveRestaurantFloor(test.db,{...f,tables:[{...f.tables[0],x:200},f.tables[1]]})).toBe(false);
 expect(test.raw.prepare("SELECT floor_x FROM rt_tables WHERE id='t1'").get()).toEqual({floor_x:100});
 expect(validRestaurantFloor({...f,tables:[f.tables[0],{...f.tables[0],id:'t2'}]})).toBe(false);
 });
});
