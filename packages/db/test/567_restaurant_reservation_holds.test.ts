import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('仮押さえと予約の同時重複をDBで止め、期限切れなら卓を使える', () => {
  const db = new Database(':memory:');
  try {
    db.exec(readFileSync(new URL(`../migrations/168_restaurant_test_foundation.sql`, import.meta.url), 'utf8'));
    // 本番では 171_restaurant_email_parsers.sql がこの列を足す（567 は足さない）。
    db.exec('ALTER TABLE rt_reservations ADD COLUMN hold_expires_at TEXT');
    for (const file of ['567_restaurant_reservation_holds.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    db.exec(`INSERT INTO rt_organizations (id, account_id, name) VALUES ('o','a','店'); INSERT INTO rt_stores(id,organization_id,name,code) VALUES ('s','o','店','S');
      INSERT INTO rt_tables(id,store_id,code,label,seat_type,max_capacity) VALUES('t','s','T','卓','table',4);
      INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,table_id,status,hold_expires_at)
      VALUES('h','s','manual','押さえ',2,'2099-01-01T10:00:00Z','2099-01-01T12:00:00Z','t','pending','2099-01-01T12:00:00Z');`);
    const insert = () => db.exec(`INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,table_id) VALUES('r','s','phone','確認',2,'2099-01-01T11:00:00Z','2099-01-01T13:00:00Z','t');`);
    expect(insert).toThrow('restaurant_table_conflict');
    db.exec("UPDATE rt_reservations SET hold_expires_at='2000-01-01T00:00:00Z' WHERE id='h'");
    expect(insert).not.toThrow();
    expect(db.prepare("SELECT status FROM rt_reservations WHERE id='h'").get()).toEqual({status:'pending'});
  } finally { db.close(); }
});
