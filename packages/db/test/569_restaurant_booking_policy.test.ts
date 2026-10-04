import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('承認だけで未来の価格を適用せず、開始後の再実行で一度だけ反映する',()=>{
 const db=new Database(':memory:');
 try{
  db.exec("CREATE TABLE staff_members(id TEXT PRIMARY KEY,role TEXT,is_active INTEGER,invite_status TEXT);");
  for(const f of ['168_restaurant_test_foundation.sql','546_restaurant_menu_approval.sql','569_restaurant_booking_policy.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8'));
  db.exec(`INSERT INTO rt_organizations(id,account_id,name) VALUES('o','a','試験'); INSERT INTO rt_stores(id,organization_id,name,code) VALUES('s','o','試験','S');
   INSERT INTO rt_menu_items(id,store_id,kind,name,price) VALUES('m','s','course','コース',8000);
   INSERT INTO rt_approval_requests(id,organization_id,store_id,kind,title,status) VALUES('a','o','s','menu_change','価格','pending');
   INSERT INTO rt_menu_change_requests(id,approval_id,menu_id,store_id,before_price,after_price,requested_by,effective_at) VALUES('r','a','m','s',8000,9000,'staff','2099-01-01T00:00:00Z');
   UPDATE rt_approval_requests SET status='approved' WHERE id='a';`);
  expect(db.prepare("SELECT price FROM rt_menu_items WHERE id='m'").get()).toEqual({price:8000});
  expect(db.prepare("SELECT status FROM rt_menu_change_requests WHERE id='r'").get()).toEqual({status:'approved'});
  db.exec("UPDATE rt_menu_change_requests SET effective_at='2000-01-01T00:00:00Z',status='approved' WHERE id='r'");
  expect(db.prepare("SELECT price FROM rt_menu_items WHERE id='m'").get()).toEqual({price:9000});
  expect(db.prepare("SELECT status FROM rt_menu_change_requests WHERE id='r'").get()).toEqual({status:'applied'});
 }finally{db.close()}
});
