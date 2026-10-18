import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('697は既存返金の累計を引き継ぎ、整数・残額・理由・通知状態・所属・履歴保持を検査する',()=>{
  const db=new Database(':memory:');
  try {
    db.pragma('foreign_keys=ON');
    db.exec(`CREATE TABLE line_accounts(id TEXT PRIMARY KEY); INSERT INTO line_accounts VALUES('a');
      CREATE TABLE bookings(id TEXT PRIMARY KEY); INSERT INTO bookings VALUES('bk');
      CREATE TABLE booking_payments(id TEXT PRIMARY KEY,amount INTEGER,status TEXT); INSERT INTO booking_payments VALUES('p',1000,'refunded');
      CREATE TABLE booking_payment_events(id TEXT PRIMARY KEY,amount INTEGER,outcome TEXT); INSERT INTO booking_payment_events VALUES('e',1000,'refunded');`);
    db.exec(readFileSync(new URL('../migrations/697_booking_payment_refunds.sql',import.meta.url),'utf8'));
    expect(db.prepare('SELECT refunded_amount FROM booking_payments').get()).toEqual({refunded_amount:1000});
    expect(db.prepare('SELECT refunded_amount FROM booking_payment_events').get()).toEqual({refunded_amount:1000});
    for(const n of [-1,1001,1.1]) expect(()=>db.prepare('UPDATE booking_payments SET refunded_amount=?').run(n)).toThrow(/CHECK/);
    const insert=db.prepare(`INSERT INTO booking_payment_refunds(id,payment_id,line_account_id,idempotency_key,amount,reason,actor_id,actor_label,notification_status,created_at)
      VALUES(?,'p',?,?,? ,?,'actor','担当','not_requested','2026-10-16T00:00:00Z')`);
    insert.run('r','a','key',300,'部分取消');
    expect(()=>insert.run('duplicate','a','key',300,'部分取消')).toThrow(/UNIQUE/);
    expect(()=>insert.run('foreign','missing','another',300,'部分取消')).toThrow(/FOREIGN KEY/);
    expect(()=>insert.run('no-reason','a','next',300,' ')).toThrow(/CHECK/);
    expect(()=>insert.run('fraction','a','next',1.2,'理由')).toThrow(/CHECK/);
    expect(()=>db.exec("UPDATE booking_payment_refunds SET notification_status='sent'")).toThrow(/CHECK/);
    expect(()=>db.exec('UPDATE booking_payment_events SET refunded_amount=1001')).toThrow(/CHECK/);
    expect(()=>db.exec("DELETE FROM booking_payments WHERE id='p'")).toThrow(/FOREIGN KEY/);
    db.exec(`INSERT INTO booking_payment_booking_links VALUES('l','p','a','bk','照合','actor','担当','2026-10-16T00:00:00Z'); DELETE FROM bookings WHERE id='bk'`);
    expect(db.prepare('SELECT booking_id,reason,actor_label FROM booking_payment_booking_links').get()).toEqual({booking_id:null,reason:'照合',actor_label:'担当'});
  } finally {db.close();}
});
