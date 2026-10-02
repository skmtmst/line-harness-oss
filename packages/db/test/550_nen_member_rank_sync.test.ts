import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('会員別の送信待ちを追加し、再実行しても本文・版・結果を残す', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec("CREATE TABLE line_accounts (id TEXT PRIMARY KEY); INSERT INTO line_accounts VALUES ('account');");
    const migration = readFileSync(new URL('../migrations/550_nen_member_rank_sync.sql', import.meta.url), 'utf8');
    db.exec(migration);
    const insert = db.prepare(`INSERT INTO nen_member_rank_sync
      (id, operation_id, line_account_id, friend_id, customer_id, rank_key, actor, reason, expected_version, created_at, updated_at)
      VALUES (?, 'operation', ?, 'friend', '42', 'gold', 'musubo:staff-example', 'ランク削除による移し替え', ?, '2026-10-02', '2026-10-02')`);
    insert.run('rank-delete:example', 'account', 7);
    expect(() => insert.run('duplicate', 'account', 7)).toThrow(/UNIQUE/);
    expect(() => db.prepare('UPDATE nen_member_rank_sync SET line_account_id = ?').run('unknown')).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare('UPDATE nen_member_rank_sync SET expected_version = ?').run(-1)).toThrow(/CHECK/);
    db.exec("UPDATE nen_member_rank_sync SET status = 'failed', error_code = 'version_conflict';");
    db.exec(migration);
    expect(db.prepare('SELECT customer_id, actor, rank_key, expected_version, status, error_code FROM nen_member_rank_sync').get())
      .toEqual({ customer_id: '42', actor: 'musubo:staff-example', rank_key: 'gold', expected_version: 7, status: 'failed', error_code: 'version_conflict' });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally { db.close(); }
});
