import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
const migration=(file:string)=>readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8');
it('photo keys backfill only unambiguous derivative paths and follow URL changes without losing legacy URLs',()=>{
 const raw=new Database(':memory:');try{
  raw.exec('CREATE TABLE nen_photo_submissions(id TEXT PRIMARY KEY,review_image_url TEXT,public_image_url TEXT)');
  const url='https://worker.example/images/nen-photo-public/f/old-custom-name.jpg';
  raw.prepare('INSERT INTO nen_photo_submissions VALUES(?,?,?)').run('legacy',null,url);
  raw.prepare('INSERT INTO nen_photo_submissions VALUES(?,?,?)').run('query',null,url+'?private=1');
  raw.exec(migration('731_photo_derivative_keys.sql'));
  expect(raw.prepare('SELECT public_image_url,public_r2_key FROM nen_photo_submissions WHERE id=?').get('legacy')).toEqual({public_image_url:url,public_r2_key:'nen-photo-public/f/old-custom-name.jpg'});
  expect(raw.prepare('SELECT public_r2_key FROM nen_photo_submissions WHERE id=?').get('query')).toEqual({public_r2_key:null});
  expect((raw.prepare('EXPLAIN QUERY PLAN SELECT id FROM nen_photo_submissions WHERE public_r2_key=?').all('nen-photo-public/f/old-custom-name.jpg') as Array<{detail:string}>).map(r=>r.detail).join(' ')).toContain('USING INDEX idx_photo_public_r2_key');
  raw.prepare('UPDATE nen_photo_submissions SET public_image_url=? WHERE id=?').run(url.replace('old-custom-name','next'),'legacy');
  expect(raw.prepare('SELECT public_r2_key FROM nen_photo_submissions WHERE id=?').get('legacy')).toEqual({public_r2_key:'nen-photo-public/f/next.jpg'});
 }finally{raw.close();}
});
it('inventory recomputes old and new intersecting windows while other hours and stores keep their versions',()=>{
 const raw=new Database(':memory:');try{
  raw.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'));
  raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('a','a','A','synthetic','synthetic'),('b','b','B','synthetic','synthetic');
   INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','試験');
   INSERT INTO rt_stores(id,organization_id,line_account_id,name,code) VALUES('store','org','a','店','S'),('other','org','b','別店','O');
   INSERT INTO rt_tables(id,store_id,code,label,seat_type,max_capacity) VALUES('table','store','T','卓','table',4),('other-table','other','O','別卓','table',4);
   INSERT INTO rt_inventory_slots(id,store_id,starts_at,total_capacity) VALUES('early','store','2099-01-01T10:00:00Z',4),('middle','store','2099-01-01T10:30:00Z',4),('later','store','2099-01-01T11:00:00Z',4),('tomorrow','store','2099-01-02T10:00:00Z',4),('foreign','other','2099-01-01T10:30:00Z',4);`);
  const untouched=raw.prepare("SELECT id,version FROM rt_inventory_slots WHERE id IN('tomorrow','foreign') ORDER BY id").all();
  raw.exec("INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,table_id) VALUES('r','store','phone','試験',2,'2099-01-01T10:15:00Z','2099-01-01T10:45:00Z','table')");
  expect(raw.prepare("SELECT id,reserved_count FROM rt_inventory_slots WHERE store_id='store' ORDER BY starts_at").all()).toEqual([{id:'early',reserved_count:2},{id:'middle',reserved_count:2},{id:'later',reserved_count:0},{id:'tomorrow',reserved_count:0}]);
  raw.exec("UPDATE rt_reservations SET starts_at='2099-01-01T10:45:00Z',ends_at='2099-01-01T11:15:00Z' WHERE id='r'");
  expect(raw.prepare("SELECT id,reserved_count FROM rt_inventory_slots WHERE store_id='store' ORDER BY starts_at").all()).toEqual([{id:'early',reserved_count:0},{id:'middle',reserved_count:2},{id:'later',reserved_count:2},{id:'tomorrow',reserved_count:0}]);
  raw.exec("UPDATE rt_reservations SET status='visited' WHERE id='r';INSERT INTO rt_seat_visit_marks(id,reservation_id,store_id,kind,marked_at) VALUES('visit','r','store','visited','2099-01-01T10:45:00Z');UPDATE rt_reservations SET departed_at='2099-01-01T11:00:00Z' WHERE id='r'");
  expect(raw.prepare("SELECT SUM(reserved_count) n FROM rt_inventory_slots").get()).toEqual({n:0});
  expect(raw.prepare("SELECT id,version FROM rt_inventory_slots WHERE id IN('tomorrow','foreign') ORDER BY id").all()).toEqual(untouched);
  expect(raw.pragma('foreign_key_check')).toEqual([]);
 }finally{raw.close();}
});
