import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { getRestaurantInventoryRules, saveRestaurantInventoryRules } from '@line-crm/db';
import { reconcileRestaurantInventory, restaurantResponsibleMembers } from './restaurant-inventory-rules.js';
import type { Env } from '../worker-env.js';
import { sendAutomaticBookingLine } from '../features/booking/booking-automatic-line.js';
vi.mock('../features/booking/booking-automatic-line.js',()=>({sendAutomaticBookingLine:vi.fn(async()=>false)}));
let fixture:SqliteD1;
const rules={storeId:'store',threshold:1,stopLine:true,stopSameDay:true,notify:true,expectedVersion:0};
const at='2027-10-10T10:00:00.000Z';
function reserve(id='reservation',status='confirmed',count=2,table:string|null='table') {
 fixture.raw.prepare(`INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,table_id,status)
 VALUES(?,'store','manual','試験用',?,?,'2027-10-10T11:00:00.000Z',?,?)`).run(id,count,at,table,status);
}
beforeEach(()=>{fixture=createTestD1();fixture.raw.exec(`
 INSERT INTO rt_organizations(id,account_id,name) VALUES('org','account','試験');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store','org','試験店舗','test','account');
 INSERT INTO rt_tables(id,store_id,code,label,seat_type,max_capacity) VALUES('table','store','t','卓','table',4);
 INSERT INTO rt_media(id,code,name,sender_addresses,parser_key) VALUES('media-hp','hotpepper','試験媒体','[]','hp'),('media-tl','tabelog','試験媒体2','[]','tl');
 INSERT INTO rt_store_media_links(store_id,media_id,close_on_booking) SELECT 'store',id,1 FROM rt_media WHERE code='hotpepper';
 INSERT INTO rt_inventory_slots(id,store_id,starts_at,total_capacity,line_capacity,same_day_capacity,walk_in_capacity) VALUES('slot','store','${at}',4,2,1,1);
 `);});
afterEach(()=>fixture.raw.close());
function slot(){return fixture.raw.prepare('SELECT * FROM rt_inventory_slots WHERE id=\'slot\'').get() as Record<string,number|null>;}
describe('飲食店の枠の自動調整',()=>{
 it('開けた確認のある世代の未送信通知は再送せず、次世代の通知は送る',async()=>{
  fixture.raw.exec(`INSERT INTO rt_memberships(id,organization_id,store_id,staff_name,role,line_uid,status) VALUES('manager','org','store','責任者','store_manager','uid','active')`);
  await saveRestaurantInventoryRules(fixture.db,rules);reserve();
  const env={DB:fixture.db} as Env['Bindings'];await reconcileRestaurantInventory(env,'store');
  fixture.raw.exec("UPDATE rt_reservations SET status='cancelled'");await reconcileRestaurantInventory(env,'store');
  const task=fixture.raw.prepare("SELECT id,generation FROM rt_channel_close_tasks LIMIT 1").get() as {id:string;generation:number};
  fixture.raw.prepare("INSERT INTO account_settings(id,line_account_id,key,value) VALUES('ack','account',?,?)").run('restaurant_close_opened:'+task.id,String(task.generation));
  vi.mocked(sendAutomaticBookingLine).mockClear();await reconcileRestaurantInventory(env,'store');
  expect(sendAutomaticBookingLine).not.toHaveBeenCalled();
  fixture.raw.exec("UPDATE rt_reservations SET status='confirmed'");await reconcileRestaurantInventory(env,'store');
  expect(sendAutomaticBookingLine).toHaveBeenCalled();
 });
 it('初期版0から保存し、古い版と存在しない版を拒否する',async()=>{
  expect((await getRestaurantInventoryRules(fixture.db,'store')).version).toBe(0);
  expect(await saveRestaurantInventoryRules(fixture.db,{...rules,expectedVersion:4})).toBe(false);
  expect(await saveRestaurantInventoryRules(fixture.db,rules)).toBe(true);
  expect(await saveRestaurantInventoryRules(fixture.db,rules)).toBe(false);
  expect(await saveRestaurantInventoryRules(fixture.db,{...rules,threshold:3,expectedVersion:1})).toBe(true);
  expect((await getRestaurantInventoryRules(fixture.db,'store')).version).toBe(2);
 });
 it('2名の4名卓を4席の占有として停止し、店頭枠を残し、取消で元の配分に戻す',async()=>{
  await saveRestaurantInventoryRules(fixture.db,rules);reserve();
  expect(slot()).toMatchObject({line_capacity:0,same_day_capacity:0,walk_in_capacity:1,auto_line_original:2,auto_same_day_original:1});
  fixture.raw.exec("UPDATE rt_reservations SET status='cancelled' WHERE id='reservation'");
  expect(slot()).toMatchObject({line_capacity:2,same_day_capacity:1,walk_in_capacity:1,auto_line_original:null});
  expect(fixture.raw.prepare('SELECT before_line,after_line,cause FROM rt_inventory_rule_log').all()).toEqual([
   {before_line:2,after_line:0,cause:'rt_reservations:insert:reservation'},
   {before_line:0,after_line:2,cause:'rt_reservations:update:reservation'}]);
 });
 it('停止中に予約が再更新されても元の値を0で上書きしない',async()=>{
  await saveRestaurantInventoryRules(fixture.db,rules);reserve();
  fixture.raw.exec("UPDATE rt_reservations SET guest_count=3 WHERE id='reservation'");
  expect(slot().auto_line_original).toBe(2);
  fixture.raw.exec("UPDATE rt_reservations SET status='cancelled' WHERE id='reservation'");expect(slot().line_capacity).toBe(2);
 });
 it('卓を追加すると席数が戻り、枠を元に戻す',async()=>{
  await saveRestaurantInventoryRules(fixture.db,rules);reserve();
  fixture.raw.exec("INSERT INTO rt_tables(id,store_id,code,label,seat_type,max_capacity) VALUES('new','store','n','追加卓','table',4)");
  expect(slot().line_capacity).toBe(2);
 });
 it('枠をまたぐ未配席予約の人数を引き、日時変更で前の枠を戻す',async()=>{
  await saveRestaurantInventoryRules(fixture.db,rules);reserve('unassigned','confirmed',3,null);
  expect(slot().line_capacity).toBe(0);
  fixture.raw.exec("UPDATE rt_reservations SET starts_at='2027-10-10T12:00:00Z',ends_at='2027-10-10T13:00:00Z' WHERE id='unassigned'");
  expect(slot().line_capacity).toBe(2);
 });
 it('停止ルールを外すと元の枠に戻す',async()=>{
  await saveRestaurantInventoryRules(fixture.db,rules);reserve();
  await saveRestaurantInventoryRules(fixture.db,{...rules,stopLine:false,stopSameDay:false,expectedVersion:1});
  expect(slot()).toMatchObject({line_capacity:2,same_day_capacity:1});
 });
 it('媒体×時間帯で重複せず、閉鎖済みの通知も席が戻ると再開に変える',async()=>{
  fixture.raw.exec("INSERT OR IGNORE INTO rt_media(id,code,name,sender_addresses,parser_key) VALUES('media-test','hotpepper','試験媒体','[]','test')");
  await saveRestaurantInventoryRules(fixture.db,rules);reserve();
  const env={DB:fixture.db} as Env['Bindings'];
  await reconcileRestaurantInventory(env,'store');await reconcileRestaurantInventory(env,'store');
  expect(fixture.raw.prepare('SELECT COUNT(*) AS n FROM rt_channel_close_tasks WHERE channel=\'hotpepper\'').get()).toEqual({n:1});
  fixture.raw.exec("UPDATE rt_channel_close_tasks SET status='done';UPDATE rt_reservations SET status='cancelled'");
  await reconcileRestaurantInventory(env,'store');
  expect(fixture.raw.prepare('SELECT status FROM rt_channel_close_tasks WHERE channel=\'hotpepper\'').get()).toEqual({status:'reopen'});
 });
 it('勤務表の責任者を優先し、指定がなければ店長、LINE未接続者も画面の対象にする',async()=>{
  fixture.raw.exec(`INSERT INTO rt_memberships(id,organization_id,store_id,staff_name,role,staff_id) VALUES('manager','org','store','店長','store_manager','m'),('duty','org','store','当番','staff','d');
  INSERT INTO staff(id,line_account_id,name,display_name,staff_member_id) VALUES('duty-staff','account','当番','当番','d');
  INSERT INTO staff_shifts(id,staff_id,work_date,start_time,end_time,is_responsible) VALUES('shift','duty-staff','2027-10-10','09:00','22:00',1);`);
  expect((await restaurantResponsibleMembers(fixture.db,'store','2027-10-10')).map(m=>m.id)).toEqual(['duty']);
  expect((await restaurantResponsibleMembers(fixture.db,'store','2027-10-11')).map(m=>m.id)).toEqual(['manager']);
 });
});

it('在庫枠がなくてもLINE・電話の予約ごとに設定した媒体だけを閉じ、取消で再開を案内する',async()=>{
 fixture.raw.exec(`INSERT INTO rt_store_media_links(store_id,media_id,close_on_booking) SELECT 'store',id,1 FROM rt_media WHERE code='tabelog';
 DELETE FROM rt_inventory_slots;
 INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,status) VALUES('direct','store','phone','試験',1,'${at}','2027-10-10T11:00:00Z','confirmed');`);
 await reconcileRestaurantInventory({DB:fixture.db} as Env['Bindings'],'store');
 const tasks=fixture.raw.prepare('SELECT channel,status FROM rt_reservation_close_tasks ORDER BY channel').all();expect(tasks).toEqual([{channel:'hotpepper',status:'close'},{channel:'tabelog',status:'close'}]);
 fixture.raw.exec("UPDATE rt_reservation_close_tasks SET status='done' WHERE channel='hotpepper'");await reconcileRestaurantInventory({DB:fixture.db} as Env['Bindings'],'store');
 expect(fixture.raw.prepare("SELECT status FROM rt_reservation_close_tasks WHERE channel='hotpepper'").get()).toEqual({status:'done'});
 fixture.raw.exec("UPDATE rt_reservations SET status='cancelled' WHERE id='direct'");await reconcileRestaurantInventory({DB:fixture.db} as Env['Bindings'],'store');
 expect(fixture.raw.prepare("SELECT COUNT(*) n FROM rt_reservation_close_tasks WHERE status='reopen'").get()).toEqual({n:2});
});

it('枠の知らせに発生時の予約経路を保存し、後の編集・取消・削除でも起点を保つ',async()=>{
 await saveRestaurantInventoryRules(fixture.db,rules);reserve('origin','confirmed',3,null);
 fixture.raw.exec("UPDATE rt_reservations SET source='hotpepper' WHERE id='origin'");
 const env={DB:fixture.db} as Env['Bindings'];await reconcileRestaurantInventory(env,'store');
 const {listRestaurantCloseTasks}=await import('@line-crm/db');
 let tasks=await listRestaurantCloseTasks(fixture.db,'store',{source:'hotpepper'});
 expect(tasks).toHaveLength(1);
 expect(tasks[0]).toMatchObject({triggerReservationId:'origin',triggerSources:expect.arrayContaining([{reservationId:'origin',source:'hotpepper',event:'update'}])});
 fixture.raw.exec("UPDATE rt_reservations SET source='tabelog',status='cancelled' WHERE id='origin'");
 await reconcileRestaurantInventory(env,'store');
 tasks=await listRestaurantCloseTasks(fixture.db,'store',{source:'hotpepper'});
 expect(tasks[0]).toMatchObject({status:'reopen',triggerReservationId:'origin'});
 fixture.raw.exec("DELETE FROM rt_reservations WHERE id='origin'");
 expect(await listRestaurantCloseTasks(fixture.db,'store',{source:'hotpepper'})).toHaveLength(1);
 expect(await listRestaurantCloseTasks(fixture.db,'store',{source:'tabelog'})).toHaveLength(0);
});
it('まとめて照合する複数予約の起点を1件に決め付けず、各経路から絞れる',async()=>{
 await saveRestaurantInventoryRules(fixture.db,rules);
 reserve('a','confirmed',2,null);reserve('b','confirmed',2,null);
 fixture.raw.exec("UPDATE rt_reservations SET source='hotpepper' WHERE id='a';UPDATE rt_reservations SET source='tabelog' WHERE id='b'");
 await reconcileRestaurantInventory({DB:fixture.db} as Env['Bindings'],'store');
 const {listRestaurantCloseTasks}=await import('@line-crm/db');
 for(const source of ['hotpepper','tabelog']) {
  const tasks=await listRestaurantCloseTasks(fixture.db,'store',{source});
  expect(tasks).toHaveLength(1);expect(tasks[0]).toMatchObject({source:null,triggerReservationId:null});
  expect(tasks[0].triggerSources?.map(s=>s.reservationId)).toEqual(expect.arrayContaining(['a','b']));
 }
 expect(fixture.raw.prepare('SELECT COUNT(*) n FROM rt_inventory_rule_source_events').get()).toEqual({n:0});
});
it('過去の枠の起点は補完せず、直接予約の経路も発生時の値を保つ',async()=>{
 fixture.raw.exec(`INSERT INTO rt_channel_close_tasks(id,store_id,slot_id,channel,status,reason,remaining_seats) VALUES('legacy','store','slot','tabelog','close','limited',1)`);
 reserve('direct-origin');fixture.raw.exec("UPDATE rt_reservations SET source='phone' WHERE id='direct-origin'");
 await reconcileRestaurantInventory({DB:fixture.db} as Env['Bindings'],'store');
 fixture.raw.exec("UPDATE rt_reservations SET source='line' WHERE id='direct-origin'");
 const {listRestaurantCloseTasks}=await import('@line-crm/db');
 expect((await listRestaurantCloseTasks(fixture.db,'store')).find(t=>t.id==='legacy')).toMatchObject({source:null,triggerReservationId:null,triggerSources:[]});
 expect((await listRestaurantCloseTasks(fixture.db,'store',{source:'phone'})).filter(t=>t.reservationId==='direct-origin')).toHaveLength(1);
 expect((await listRestaurantCloseTasks(fixture.db,'store',{source:'line'})).filter(t=>t.reservationId==='direct-origin')).toHaveLength(0);
});
it('照合中に次の予約変更が来ても、古い起点で新しい知らせを作らず、未処理の起点を残す',async()=>{
 await saveRestaurantInventoryRules(fixture.db,rules);reserve('first','confirmed',3,null);
 fixture.raw.exec("UPDATE rt_reservations SET source='hotpepper' WHERE id='first'");
 const base=fixture.db;let injected=false;
 const db={...base,prepare(sql:string){
  const statement=base.prepare(sql);
  if(!sql.startsWith('SELECT MAX(id) AS id FROM rt_inventory_rule_source_events'))return statement;
  return {...statement,bind(...args:unknown[]){const bound=statement.bind(...args);return {...bound,async first<T>(){
   const value=await bound.first<T>();
   if(!injected){injected=true;reserve('second','confirmed',1,null);fixture.raw.exec("UPDATE rt_reservations SET source='tabelog' WHERE id='second'");}
   return value;
  }}}};
 }} as D1Database;
 await reconcileRestaurantInventory({DB:db} as Env['Bindings'],'store');
 expect(fixture.raw.prepare('SELECT COUNT(*) n FROM rt_channel_close_tasks').get()).toEqual({n:0});
 expect(fixture.raw.prepare('SELECT COUNT(*) n FROM rt_inventory_rule_queue').get()).toEqual({n:1});
 expect((fixture.raw.prepare('SELECT COUNT(*) n FROM rt_inventory_rule_source_events').get() as {n:number}).n).toBeGreaterThan(0);
 await reconcileRestaurantInventory({DB:base} as Env['Bindings'],'store');
 const {listRestaurantCloseTasks}=await import('@line-crm/db');
 expect(await listRestaurantCloseTasks(base,'store',{source:'hotpepper'})).toHaveLength(1);
 expect(await listRestaurantCloseTasks(base,'store',{source:'tabelog'})).toHaveLength(1);
 expect(fixture.raw.prepare('SELECT COUNT(*) n FROM rt_inventory_rule_source_events').get()).toEqual({n:0});
});
it('ルールの保存で起きた閉鎖へ、先にあった予約の起点を推測して付けない',async()=>{
 reserve('old-change','confirmed',3,null);await saveRestaurantInventoryRules(fixture.db,rules);
 await reconcileRestaurantInventory({DB:fixture.db} as Env['Bindings'],'store');
 const {listRestaurantCloseTasks}=await import('@line-crm/db');
 expect((await listRestaurantCloseTasks(fixture.db,'store'))[0]).toMatchObject({source:null,triggerReservationId:null,triggerSources:[]});
});
