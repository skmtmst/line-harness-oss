import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '264_nen_friend_add_coupons.sql'),
  'utf8',
);

describe('migration 264 NEN友だち追加クーポン', () => {
  it('allows only one issue per friend and keeps accounts separated', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE friends (id TEXT PRIMARY KEY);
      INSERT INTO line_accounts (id) VALUES ('account-a'), ('account-b');
      INSERT INTO friends (id) VALUES ('friend-a');
    `);
    db.exec(migration);

    const insert = db.prepare(`
      INSERT INTO nen_friend_add_coupon_issues
        (id, line_account_id, friend_id, coupon_code, discount_rate, valid_from, expires_at,
         status, created_at, updated_at)
      VALUES (?, ?, 'friend-a', ?, 5, '2026-09-02', '2026-10-03', 'pending', '2026-09-02', '2026-09-02')
    `);
    insert.run('issue-a', 'account-a', 'NENLINE-AAAA1111');
    expect(() => insert.run('issue-b', 'account-a', 'NENLINE-BBBB2222')).toThrow();
    expect(() => insert.run('issue-c', 'account-b', 'NENLINE-AAAA1111')).toThrow();
    expect(insert.run('issue-d', 'account-b', 'NENLINE-DDDD4444').changes).toBe(1);
  });
});
