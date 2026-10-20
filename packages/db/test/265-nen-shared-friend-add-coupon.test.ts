import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const base = readFileSync(join(import.meta.dirname, '..', 'migrations', '264_nen_friend_add_coupons.sql'), 'utf8');
const migration = readFileSync(join(import.meta.dirname, '..', 'migrations', '265_nen_shared_friend_add_coupon.sql'), 'utf8');

describe('migration 265 NEN shared friend-add coupon', () => {
  it('keeps existing issues and permits one shared code for multiple friends', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE friends (id TEXT PRIMARY KEY);
      INSERT INTO line_accounts (id) VALUES ('account-a');
      INSERT INTO friends (id) VALUES ('friend-a'), ('friend-b');
    `);
    db.exec(base);
    db.prepare(`
      INSERT INTO nen_friend_add_coupon_issues
        (id, line_account_id, friend_id, coupon_code, discount_rate, valid_from, expires_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('issue-a', 'account-a', 'friend-a', 'NENLINE-OLD', 5, '2026-09-02', '2026-10-03', 'sent', 'now', 'now');

    db.exec(migration);
    db.prepare(`
      INSERT INTO nen_friend_add_coupon_issues
        (id, line_account_id, friend_id, coupon_code, discount_rate, valid_from, expires_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('issue-b', 'account-a', 'friend-b', 'NENLINE-OLD', 5, '2026-09-03', '2026-12-31', 'sent', 'now', 'now');

    expect(db.prepare(`SELECT coupon_code FROM nen_friend_add_coupon_issues ORDER BY id`).all())
      .toEqual([{ coupon_code: 'NENLINE-OLD' }, { coupon_code: 'NENLINE-OLD' }]);
  });
});
