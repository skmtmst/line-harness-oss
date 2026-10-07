import { createTestD1 } from './d1-sqlite.js';
/** 実際のschemaで担当・店の席・設備と仮押さえを一緒に検査する。値は全て架空。 */
export function waitlistFixture() {
  const test = createTestD1(), s = test.raw; s.pragma('foreign_keys=OFF');
  s.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,liff_id) VALUES('a','試験店','test-channel','test-only-secret','test-only-token','test-liff');
 INSERT INTO staff(id,line_account_id,name,display_name) VALUES('s','a','試験担当','試験担当'),('other','a','別の試験担当','別の試験担当');
 INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('m','a','試験メニュー',60,0),('other-menu','a','別のメニュー',60,0);
 INSERT INTO staff_menus(staff_id,menu_id,is_offered) VALUES('s','m',1),('other','m',1),('s','other-menu',1);
 INSERT INTO booking_settings(id,line_account_id,business_hours_configured,cutoff_minutes_before,booking_window_days,max_active_bookings_per_friend) VALUES('settings','a',1,1440,365,10);
 INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','試験組織');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store','org','試験店','test','a');
 INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES('t','store','test-t','試験卓','table',1,2),('large','store','test-large','試験大卓','table',1,6);`);
  for (let i = 0; i < 8; i++)s.prepare(`INSERT INTO friends(id,line_account_id,line_user_id,display_name,is_following) VALUES(?,'a',?,'試験のお客さま',1)`).run('f' + i, 'test-user-' + i);
  for (let i = 0; i < 7; i++) {
    s.prepare(`INSERT INTO booking_business_hours(id,booking_settings_id,weekday,start_time,end_time,capacity) VALUES(?,'settings',?,'00:00','23:59',10)`).run('hours' + i, i);
    for (const staff of ['s', 'other']) s.prepare(`INSERT INTO staff_availability_rules(id,staff_id,weekday,start_time,end_time) VALUES(?,?,?,'00:00','23:59')`).run(staff + i, staff, i);
  }
  return test;
}
export function futureSlot(days = 2) { const day = new Date(Date.now() + days * 86400_000); return day.toISOString().slice(0, 10) + 'T05:00:00.000Z'; }
