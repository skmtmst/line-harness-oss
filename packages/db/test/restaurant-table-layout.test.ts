import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('卓の位置と結合の更新で席数・予約への関連を壊さない',()=>{
 const db=new Database(':memory:');try{
 db.exec(readFileSync(new URL('../migrations/168_restaurant_test_foundation.sql',import.meta.url),'utf8'));
 db.exec(`INSERT INTO rt_organizations(id,account_id,name) VALUES('o','a','試験'); INSERT INTO rt_stores(id,organization_id,name,code) VALUES('s','o','試験','S');
 INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES('t','s','T','試験','table',1,4);
 INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,table_id) VALUES('r','s','phone','試験',2,'2099-01-01T00:00:00Z','2099-01-01T02:00:00Z','t');
 UPDATE rt_tables SET floor_x=2,floor_y=1,join_group='A' WHERE id='t';`);
 expect(db.prepare('SELECT floor_x,floor_y,join_group,max_capacity FROM rt_tables').get()).toEqual({floor_x:2,floor_y:1,join_group:'A',max_capacity:4});
 expect(db.prepare('SELECT table_id FROM rt_reservations').get()).toEqual({table_id:'t'});
 db.exec("UPDATE rt_tables SET join_group=NULL WHERE id='t'");expect(db.prepare('SELECT join_group FROM rt_tables').get()).toEqual({join_group:null});
 }finally{db.close()}
});
