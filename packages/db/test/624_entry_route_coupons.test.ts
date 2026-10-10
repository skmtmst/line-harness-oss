import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(fileURLToPath(new URL('../migrations/624_entry_route_coupons.sql', import.meta.url)), 'utf8');
describe('624 クーポンQR: 既存DBからの追加', () => {
  it('従来の経路・使用履歴を保ち、既存経路はクーポンOFF。1人1回と履歴の参照をDBで守る', () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.pragma('foreign_keys=ON');
      sqlite.exec(`CREATE TABLE line_accounts(id TEXT PRIMARY KEY);
        CREATE TABLE friends(id TEXT PRIMARY KEY);
        CREATE TABLE broadcast_message_assets(id TEXT PRIMARY KEY);
        CREATE TABLE entry_routes(id TEXT PRIMARY KEY,name TEXT);
        CREATE TABLE coupon_redemptions(id TEXT PRIMARY KEY,asset_id TEXT,friend_id TEXT);
        INSERT INTO line_accounts VALUES('a'); INSERT INTO friends VALUES('f');
        INSERT INTO broadcast_message_assets VALUES('c'); INSERT INTO entry_routes VALUES('r','店頭');
        INSERT INTO coupon_redemptions VALUES('old-use','c','f');`);
      sqlite.exec(migration);
      expect(sqlite.prepare('SELECT * FROM entry_routes').get()).toEqual({ id: 'r', name: '店頭', coupon_asset_id: null, coupon_enabled: 0, coupon_audience: 'new_friends' });
      expect(sqlite.prepare('SELECT * FROM coupon_redemptions').get()).toEqual({ id: 'old-use', asset_id: 'c', friend_id: 'f', entry_route_coupon_receipt_id: null });
      sqlite.exec(`UPDATE entry_routes SET coupon_asset_id='c',coupon_enabled=1;
        INSERT INTO entry_route_coupon_receipts(id,entry_route_id,asset_id,friend_id,line_account_id,status,asset_name,payload_snapshot,created_at,received_at)
        VALUES('receipt','r','c','f','a','received','割引','{}','2026-10-10','2026-10-10');`);
      expect(() => sqlite.exec(`INSERT INTO entry_route_coupon_receipts SELECT 'duplicate',entry_route_id,asset_id,friend_id,line_account_id,status,asset_name,payload_snapshot,created_at,received_at FROM entry_route_coupon_receipts`)).toThrow(/UNIQUE/);
      expect(() => sqlite.exec("UPDATE entry_routes SET coupon_audience='invalid'")).toThrow(/CHECK/);
      sqlite.exec("UPDATE coupon_redemptions SET entry_route_coupon_receipt_id='receipt'; DELETE FROM broadcast_message_assets WHERE id='c'");
      expect(sqlite.prepare('SELECT coupon_asset_id FROM entry_routes').get()).toEqual({ coupon_asset_id: null });
      expect(sqlite.prepare('SELECT asset_id FROM entry_route_coupon_receipts').get()).toEqual({ asset_id: 'c' });
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    } finally { sqlite.close(); }
  });
});
