import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('卓から出す予約枠への移行', () => {
  it('既存枠を26席へ揃え、卓の停止で総数と版を更新する', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      db.exec(readFileSync(new URL('../migrations/168_restaurant_test_foundation.sql', import.meta.url), 'utf8'));
      db.exec(`INSERT INTO rt_organizations (id, account_id, name) VALUES ('org', 'account', '確認');
        INSERT INTO rt_stores (id, organization_id, name, code) VALUES ('store', 'org', '確認', 'S');
        INSERT INTO rt_inventory_slots (id, store_id, starts_at, total_capacity) VALUES ('slot', 'store', '2026-10-10T10:00:00Z', 32);`);
      for (const [i, capacity] of [2, 2, 4, 4, 1, 1, 8, 4].entries()) {
        db.prepare("INSERT INTO rt_tables (id, store_id, code, label, seat_type, min_capacity, max_capacity) VALUES (?, 'store', ?, '確認', 'table', 1, ?)").run(`t${i}`, `T${i}`, capacity);
      }
      db.exec("INSERT INTO rt_tables (id, store_id, code, label, seat_type, min_capacity, max_capacity, is_active) VALUES ('off', 'store', 'OFF', '停止', 'table', 1, 100, 0);");
      db.exec(readFileSync(new URL('../migrations/547_restaurant_inventory_from_tables.sql', import.meta.url), 'utf8'));
      expect(db.prepare('SELECT total_capacity, version FROM rt_inventory_slots').get()).toEqual({ total_capacity: 26, version: 1 });
      db.exec("UPDATE rt_tables SET is_active = 0 WHERE id = 't6';");
      expect(db.prepare('SELECT total_capacity, version FROM rt_inventory_slots').get()).toEqual({ total_capacity: 18, version: 2 });
      db.exec("INSERT INTO rt_inventory_slots (id, store_id, starts_at, total_capacity) VALUES ('new', 'store', '2026-10-11T10:00:00Z', 999);");
      expect(db.prepare("SELECT total_capacity FROM rt_inventory_slots WHERE id = 'new'").get()).toEqual({ total_capacity: 18 });
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });
});
