import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
it('644は既存の店/メニューの値を保ち、選択方式と予約時の写しを保存できる',()=>{
 const db=new Database(':memory:');try{
 db.pragma('foreign_keys=ON');
 db.exec(`CREATE TABLE line_accounts(id TEXT PRIMARY KEY); CREATE TABLE menus(id TEXT PRIMARY KEY); CREATE TABLE bookings(id TEXT PRIMARY KEY);
 INSERT INTO line_accounts VALUES('a'); INSERT INTO menus VALUES('m'); INSERT INTO bookings VALUES('b');`);
 db.exec(readFileSync(new URL('../migrations/558_booking_payments.sql',import.meta.url),'utf8'));
 db.exec(`INSERT INTO booking_payment_configs VALUES('a','online','stripe',10,'before','after');
 INSERT INTO booking_payment_menu_settings VALUES('m','a','onsite','onsite','created','updated');`);
 db.exec(readFileSync(new URL('../migrations/644_booking_customer_payment_choice.sql',import.meta.url),'utf8'));
 expect(db.prepare('SELECT * FROM booking_payment_configs').get()).toEqual({line_account_id:'a',mode:'online',provider:'stripe',hold_minutes:10,created_at:'before',updated_at:'after'});
 expect(db.prepare('SELECT * FROM booking_payment_menu_settings').get()).toEqual({menu_id:'m',line_account_id:'a',mode:'onsite',provider:'onsite',created_at:'created',updated_at:'updated'});
 db.exec("UPDATE booking_payment_configs SET mode='customer_choice'; UPDATE booking_payment_menu_settings SET mode='customer_choice'; INSERT INTO booking_payment_choices VALUES('b','a','onsite','onsite',10)");
 expect(()=>db.exec("UPDATE booking_payment_configs SET mode='bad'")).toThrow(/CHECK/);
 expect(db.pragma('foreign_key_check')).toEqual([]);
 }finally{db.close()}
});
