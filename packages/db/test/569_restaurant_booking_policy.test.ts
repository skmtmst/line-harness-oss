import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('承認だけで未来の価格を適用せず、開始後の再実行で一度だけ反映する',()=>{
 const db=new Database(':memory:');
 try{
  db.exec("CREATE TABLE line_accounts(id TEXT PRIMARY KEY); INSERT INTO line_accounts VALUES('a1'),('a2'); CREATE TABLE staff_members(id TEXT PRIMARY KEY,role TEXT,is_active INTEGER,invite_status TEXT,account_scope TEXT); CREATE TABLE staff_account_scopes(staff_id TEXT,line_account_id TEXT);");
  for(const f of ['168_restaurant_test_foundation.sql','173_restaurant_store_line_account.sql','546_restaurant_menu_approval.sql','569_restaurant_booking_policy.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8'));
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

it('ログインの役割・停止・担当範囲の変更を名簿へ同期し、同じログインの二重連携を拒む',()=>{
 const db=new Database(':memory:');try{
 db.exec("CREATE TABLE line_accounts(id TEXT PRIMARY KEY); INSERT INTO line_accounts VALUES('a1'),('a2'); CREATE TABLE staff_members(id TEXT PRIMARY KEY,role TEXT,is_active INTEGER,invite_status TEXT,account_scope TEXT); CREATE TABLE staff_account_scopes(staff_id TEXT,line_account_id TEXT);");
 for(const f of ['168_restaurant_test_foundation.sql','173_restaurant_store_line_account.sql','546_restaurant_menu_approval.sql','569_restaurant_booking_policy.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8'));
 db.exec(`INSERT INTO rt_organizations(id,account_id,name) VALUES('o','a','試験'); INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('s1','o','一','S1','a1'),('s2','o','二','S2','a2');
 INSERT INTO staff_members VALUES('u','staff',1,'active','accounts'); INSERT INTO staff_account_scopes VALUES('u','a1');
 INSERT INTO rt_memberships(id,organization_id,store_id,staff_name,role,staff_id) VALUES('m','o','s1','試験','staff','u');
 UPDATE staff_members SET role='admin',is_active=0 WHERE id='u';`);
 expect(db.prepare("SELECT role,status FROM rt_memberships WHERE id='m'").get()).toEqual({role:'store_manager',status:'suspended'});
 db.exec("DELETE FROM staff_account_scopes WHERE staff_id='u'; INSERT INTO staff_account_scopes VALUES('u','a2');");
 expect(db.prepare("SELECT store_id FROM rt_memberships WHERE id='m'").get()).toEqual({store_id:'s2'});
 expect(()=>db.exec("INSERT INTO rt_memberships(id,organization_id,staff_name,role,staff_id) VALUES('m2','o','重複','staff','u')")).toThrow(/unique/i);
 db.exec("UPDATE staff_members SET account_scope='all' WHERE id='u'");
 expect(db.prepare("SELECT store_id FROM rt_memberships WHERE id='m'").get()).toEqual({store_id:null});
 }finally{db.close()}
});
