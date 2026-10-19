import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';

let db: Database.Database;
beforeEach(()=>{
  db=new Database(':memory:');db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE line_accounts(id TEXT PRIMARY KEY); CREATE TABLE menus(id TEXT PRIMARY KEY);
    CREATE TABLE bookings(id TEXT PRIMARY KEY); CREATE TABLE events(id TEXT PRIMARY KEY,line_account_id TEXT);
    CREATE TABLE rt_stores(id TEXT PRIMARY KEY,line_account_id TEXT);
    CREATE TABLE rt_menu_items(id TEXT PRIMARY KEY,store_id TEXT,kind TEXT);
    INSERT INTO line_accounts VALUES('a'),('b'); INSERT INTO menus VALUES('m'); INSERT INTO bookings VALUES('bk');
    INSERT INTO events VALUES('ev','a'),('other','b'); INSERT INTO rt_stores VALUES('store','a');
    INSERT INTO rt_menu_items VALUES('course','store','course'),('food','store','a_la_carte');`);
  db.exec(readFileSync(new URL('../migrations/558_booking_payments.sql',import.meta.url),'utf8'));
  db.exec(`INSERT INTO booking_payments(id,line_account_id,booking_id,amount,status,provider,idempotency_key,created_at,updated_at)
    VALUES('p','a','bk',1200,'paid','stripe','k','created','updated')`);
  for(const file of ['663_booking_payment_connections.sql','664_booking_payment_events.sql','665_booking_course_event_payment_settings.sql'])
    db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
});
afterEach(()=>db.close());

it('663〜665は既存の金額・状態を保ち、通知に秘密値を保存する欄を持たない',()=>{
  expect(db.prepare('SELECT amount,status,refunded_at,receipt_url FROM booking_payments').get())
    .toEqual({amount:1200,status:'paid',refunded_at:null,receipt_url:null});
  const columns=db.pragma('table_info(booking_payment_events)') as {name:string}[];
  expect(columns.map(c=>c.name).join(' ')).not.toMatch(/secret|raw_body|signature/);
  db.exec(`INSERT INTO booking_payment_connections(line_account_id,provider,provider_account_id,connected_at)
    VALUES('a','stripe','acct_test','2026-10-16T00:00:00Z')`);
  expect(()=>db.exec("UPDATE booking_payment_connections SET test_mode=3")).toThrow(/CHECK/);
  expect(()=>db.exec("UPDATE booking_payment_connections SET connected_at='invalid'")).toThrow(/CHECK/);
  expect(db.pragma('foreign_key_check')).toEqual([]);
});
it('通知の再送キーは店・サービスごとに一意で、支払いの削除後も履歴と再読込監査が残る',()=>{
  const insert=db.prepare(`INSERT INTO booking_payment_events(id,line_account_id,provider,provider_event_id,payment_id,provider_payment_id,kind,outcome,received_at)
    VALUES(?,'a','stripe','evt','p','pi_test','paid','paid','2026-10-16T00:00:00Z')`);
  insert.run('evt');expect(()=>insert.run('second')).toThrow(/UNIQUE/);
  db.exec(`INSERT INTO booking_payment_event_replays(id,event_id,actor_id,occurred_at,source_version,result)
    VALUES('r','evt','operator','2026-10-16T01:00:00Z',0,'applied'); DELETE FROM bookings WHERE id='bk';`);
  expect(db.prepare('SELECT payment_id FROM booking_payment_events').get()).toEqual({payment_id:null});
  expect(db.prepare('SELECT actor_id FROM booking_payment_event_replays').get()).toEqual({actor_id:'operator'});
  expect(db.pragma('foreign_key_check')).toEqual([]);
});
it('コースとクラスの所属と金額・方式の制約をDBでも守る',()=>{
  db.exec(`INSERT INTO restaurant_course_payment_settings(menu_id,line_account_id,store_id,mode,updated_by,updated_at)
    VALUES('course','a','store','customer_choice','operator','now');
    INSERT INTO event_payment_settings(event_id,line_account_id,mode,unit_price,updated_by,updated_at)
    VALUES('ev','a','online',1000,'operator','now')`);
  expect(()=>db.exec("UPDATE restaurant_course_payment_settings SET line_account_id='b'")).toThrow(/scope_mismatch/);
  expect(()=>db.exec("UPDATE restaurant_course_payment_settings SET menu_id='food'")).toThrow(/scope_mismatch/);
  expect(()=>db.exec("UPDATE event_payment_settings SET line_account_id='b'")).toThrow(/scope_mismatch/);
  for(const value of ['-1','1.1',"'cash'"]) expect(()=>db.exec(`UPDATE event_payment_settings SET unit_price=${value}`)).toThrow(/CHECK/);
  expect(()=>db.exec("UPDATE event_payment_settings SET mode='cash'")).toThrow(/CHECK/);
  expect(db.pragma('foreign_key_check')).toEqual([]);
});
