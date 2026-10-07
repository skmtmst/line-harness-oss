import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { getRestaurantInventoryRules, saveRestaurantInventoryRules } from '@line-crm/db';
import { reconcileRestaurantInventory, restaurantResponsibleMembers } from './restaurant-inventory-rules.js';
import type { Env } from '../index.js';
vi.mock('./booking-automatic-line.js',()=>({sendAutomaticBookingLine:vi.fn(async()=>false)}));
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
 INSERT INTO rt_inventory_slots(id,store_id,starts_at,total_capacity,line_capacity,same_day_capacity,walk_in_capacity) VALUES('slot','store','${at}',4,2,1,1);
 `);});
afterEach(()=>fixture.raw.close());
function slot(){return fixture.raw.prepare('SELECT * FROM rt_inventory_slots WHERE id=\'slot\'').get() as Record<string,number|null>;}
describe('飲食店の枠の自動調整',()=>{
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
