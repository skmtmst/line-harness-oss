import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('682はハッシュと操作者を保存し、店の削除で短命stateを削除。期限/状態/ハッシュ/所属を検査する', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys=ON');
    db.exec("CREATE TABLE line_accounts(id TEXT PRIMARY KEY); INSERT INTO line_accounts VALUES('a')");
    db.exec(readFileSync(new URL('../migrations/682_booking_stripe_connect_states.sql', import.meta.url), 'utf8'));
    const insert = db.prepare(`INSERT INTO booking_stripe_connect_states(line_account_id,state_hash,staff_id,session_hash,status,expires_at)
      VALUES(?,?,'operator',?,'pending','2030-01-01T00:00:00Z')`);
    insert.run('a', 'a'.repeat(64), 'b'.repeat(64));
    expect(() => insert.run('missing', 'c'.repeat(64), 'd'.repeat(64))).toThrow(/FOREIGN KEY/);
    expect(() => db.exec("UPDATE booking_stripe_connect_states SET status='unknown'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE booking_stripe_connect_states SET state_hash='raw'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE booking_stripe_connect_states SET expires_at='invalid'")).toThrow(/CHECK/);
    expect(db.prepare('SELECT staff_id FROM booking_stripe_connect_states').get()).toEqual({ staff_id: 'operator' });
    db.exec("DELETE FROM line_accounts WHERE id='a'");
    expect(db.prepare('SELECT COUNT(*) n FROM booking_stripe_connect_states').get()).toEqual({ n: 0 });
  } finally { db.close(); }
});
