import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {describe,it,expect} from 'vitest';
const root=join(import.meta.dirname,'..');
function beforeProposal(){
 const db=new Database(':memory:');db.exec(readFileSync(join(root,'schema.sql'),'utf8'));
 for(const name of readdirSync(join(root,'migrations')).filter(n=>n.endsWith('.sql')&&Number(n.split('_')[0])<594).sort()){
  for(const sql of readFileSync(join(root,'migrations',name),'utf8').split(/;\s*(?:\r?\n|$)/).map(s=>s.trim()).filter(Boolean)){
   try{db.exec(sql);}catch(e){if(!/already exists|duplicate column name/i.test(String(e)))throw e;}
  }
 }
 db.exec("PRAGMA foreign_keys=ON;");
 db.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token) VALUES('account','試験店','channel','unused','unused');
 INSERT INTO rt_organizations(id,account_id,name) VALUES('org','account','試験');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store','org','店','STORE','account');
 INSERT OR IGNORE INTO rt_media(id,code,name,parser_key) VALUES('media','hotpepper','媒体','hp');
 INSERT INTO rt_tables(id,store_id,code,label,seat_type,max_capacity) VALUES('table','store','T','卓','table',4);
 INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,status,table_id,media_id)
 VALUES('reservation','store','hotpepper','試験',2,'2030-01-01T10:00:00Z','2030-01-01T11:00:00Z','visited','table',(SELECT id FROM rt_media WHERE code='hotpepper'));
 INSERT INTO rt_inbound_emails(id,message_id,store_id,media_id,status) SELECT 'mail','message','store',id,'stored' FROM rt_media WHERE code='hotpepper';
 INSERT INTO rt_email_digests(id,store_id,media_id,target_date,reported_count,inbound_email_id) SELECT 'digest','store',id,'2030-01-01',1,'mail' FROM rt_media WHERE code='hotpepper';
 INSERT INTO rt_seat_visit_marks(id,reservation_id,store_id,kind,marked_at) VALUES('mark','reservation','store','visited','2030-01-01T10:00:00Z');`);
 return db;
}
describe('飲食店の提案Eマイグレーション草稿',()=>{
 it('594は外部キーが有効でも既存予約・来店印・参照先を残す',()=>{
  const db=beforeProposal();try{
   db.transaction(()=>db.exec(readFileSync(join(root,'migrations/594_restaurant_walk_in.sql'),'utf8')))();
   expect(db.prepare('SELECT id,reservation_id,undone_at FROM rt_seat_visit_marks').all()).toEqual([{id:'mark',reservation_id:'reservation',undone_at:null}]);
   expect(db.prepare('SELECT id,media_id,table_id FROM rt_reservations').get()).toEqual({id:'reservation',media_id:(db.prepare("SELECT id FROM rt_media WHERE code='hotpepper'").get() as {id:string}).id,table_id:'table'});
   expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
   db.prepare("UPDATE rt_reservations SET source='walk_in' WHERE id='reservation'").run();
  }finally{db.close();}
 });
 it('595は媒体を参照する予約を残し、予約を受けない媒体を追加できる',()=>{
  const db=beforeProposal();try{
   db.transaction(()=>db.exec(readFileSync(join(root,'migrations/595_restaurant_media_links.sql'),'utf8')))();
   expect(db.prepare('SELECT media_id FROM rt_reservations').get()).toEqual({media_id:(db.prepare("SELECT id FROM rt_media WHERE code='hotpepper'").get() as {id:string}).id});
   expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
   expect(db.prepare("SELECT media_id FROM rt_inbound_emails WHERE id='mail'").get()).toEqual(db.prepare('SELECT media_id FROM rt_reservations').get());
   expect(db.prepare("SELECT id,inbound_email_id FROM rt_email_digests WHERE id='digest'").get()).toEqual({id:'digest',inbound_email_id:'mail'});
   db.exec("INSERT INTO rt_media(id,code,name,parser_key,is_active,accepts_reservations) VALUES('gourmet','gourmet_test','グルメ','gourmet_test',0,0)");
  }finally{db.close();}
 });
});
