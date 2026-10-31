import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { createTestD1 } from './d1-sqlite.js';

/** 顧客・担当者・卓・コースの名前がすべて異なる予約。 */
export function createStyleScheduleFixture() {
  const fixture = createTestD1();
  fixture.raw.pragma('foreign_keys=OFF');
  fixture.raw.prepare("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a','a','店A','token','secret',?),('b','b','店B','token','secret',?)").run(DEFAULT_TENANT_ID, DEFAULT_TENANT_ID);
  fixture.raw.exec(`
    INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('f','Uf','a','顧客 花子');
    INSERT INTO staff(id,line_account_id,name,display_name) VALUES('s','a','担当 太郎','担当 太郎');
    INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('m','a','相談メニュー',60,5000),('foreign-menu','b','別店のメニュー',60,5000);
    INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','本部');
    INSERT INTO rt_stores(id,organization_id,line_account_id,name,code) VALUES('store','org','a','店A','A'),('other-store','org',NULL,'店Aの別店舗','A2'),('foreign-store','org','b','店B','B');
    INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity,is_active) VALUES('t1','store','T1','窓側2人卓','table',1,2,1),('t2','store','T2','奥の4人卓','table',1,4,1),('t3','other-store','T3','同一アカウントの別店舗卓','table',1,4,1),('foreign-table','foreign-store','T4','別店の卓','table',1,4,1);
    INSERT INTO rt_menu_items(id,store_id,kind,name,price) VALUES('course','store','course','季節のコース',8000),('other-course','other-store','course','別店舗のコース',6000),('foreign-course','foreign-store','course','別店のコース',6000);
    INSERT INTO rt_reservations(id,store_id,source,customer_name,line_uid,guest_count,starts_at,ends_at,table_id,course_id,status) VALUES('r','store','line','顧客 花子','Uf',2,'2026-11-01T01:00:00Z','2026-11-01T02:00:00Z','t1','course','confirmed');
    INSERT OR IGNORE INTO rt_reservation_table_links(reservation_id,table_id) VALUES('r','t1'),('r','t2');
    UPDATE rt_tables SET is_active=0 WHERE id='t2';
    INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at) VALUES('booking','a','f','s','m','2026-11-01T01:00:00Z','2026-11-01T02:00:00Z','2026-11-01T02:00:00Z','confirmed',5000,'2026-10-30T00:00:00Z');
    INSERT INTO events(id,line_account_id,name,is_published) VALUES('event','a','朝のヨガ',1);
    INSERT INTO event_slots(id,event_id,starts_at,ends_at,capacity,is_active) VALUES('slot','event','2026-11-01T01:00:00Z','2026-11-01T02:00:00Z',10,1);
    INSERT INTO event_bookings(id,event_id,slot_id,line_account_id,friend_id,status,requested_at) VALUES('event-booking','event','slot','a','f','confirmed','2026-10-30T00:00:00Z');
  `);
  return fixture;
}
