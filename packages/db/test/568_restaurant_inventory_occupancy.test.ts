import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('途中の枠にも占有を数え、取消で空きと版を更新する',()=>{
 const db=new Database(':memory:');
 try{
  const run=(f:string)=>db.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8'));
  run('168_restaurant_test_foundation.sql');
  // 本番では 171_restaurant_email_parsers.sql がこの列を足す（567 は足さない）。
  db.exec('ALTER TABLE rt_reservations ADD COLUMN hold_expires_at TEXT');
  for(const f of ['547_restaurant_inventory_from_tables.sql','567_restaurant_reservation_holds.sql','568_restaurant_inventory_occupancy.sql']) run(f);
  db.exec(`INSERT INTO rt_organizations(id,account_id,name) VALUES('o','a','試験'); INSERT INTO rt_stores(id,organization_id,name,code) VALUES('s','o','試験','S');
   INSERT INTO rt_tables(id,store_id,code,label,seat_type,max_capacity) VALUES('t','s','T','卓','table',4);
   INSERT INTO rt_inventory_slots(id,store_id,starts_at,total_capacity) VALUES('i','s','2099-01-01T10:30:00Z',4);
   INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,table_id) VALUES('r','s','phone','試験',2,'2099-01-01T10:00:00Z','2099-01-01T11:00:00Z','t');`);
  expect(db.prepare('SELECT guest_count,occupied_seats,version FROM rt_inventory_occupancy').get()).toEqual({guest_count:2,occupied_seats:4,version:2});
  db.exec("UPDATE rt_reservations SET status='cancelled' WHERE id='r'");
  expect(db.prepare('SELECT reserved_count,guest_count,occupied_seats,version FROM rt_inventory_occupancy').get()).toEqual({reserved_count:0,guest_count:0,occupied_seats:0,version:3});
 }finally{db.close()}
});
