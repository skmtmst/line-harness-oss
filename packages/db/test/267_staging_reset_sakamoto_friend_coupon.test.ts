import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '267_staging_reset_sakamoto_friend_coupon.sql'),
  'utf8',
);

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE friends (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      is_following INTEGER NOT NULL,
      unfollow_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE account_settings (
      id TEXT PRIMARY KEY,
      line_account_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE nen_friend_add_coupon_issues (
      id TEXT PRIMARY KEY,
      line_account_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      coupon_code TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);
  return db;
}

function insertCandidate(db: Database.Database, suffix: string, overrides: {
  accountName?: string;
  displayName?: string;
  isFollowing?: number;
  unfollowCount?: number;
  couponCode?: string;
} = {}) {
  const accountId = `account-${suffix}`;
  const friendId = `friend-${suffix}`;
  db.prepare(`INSERT INTO line_accounts (id, name) VALUES (?, ?)`).run(
    accountId,
    overrides.accountName ?? '然-NEN- TEST',
  );
  db.prepare(`INSERT INTO friends (id, display_name, is_following, unfollow_count, updated_at) VALUES (?, ?, ?, ?, 'before')`).run(
    friendId,
    overrides.displayName ?? 'さかもとまさと',
    overrides.isFollowing ?? 0,
    overrides.unfollowCount ?? 1,
  );
  db.prepare(`INSERT INTO account_settings (id, line_account_id, key, value) VALUES (?, ?, 'nen.friend_add_coupon', ?)`).run(
    `setting-${suffix}`,
    accountId,
    JSON.stringify({ deliveryMode: 'shared', sharedCouponCode: 'LINEREG5' }),
  );
  db.prepare(`INSERT INTO nen_friend_add_coupon_issues (id, line_account_id, friend_id, coupon_code, status) VALUES (?, ?, ?, ?, 'sent')`).run(
    `issue-${suffix}`,
    accountId,
    friendId,
    overrides.couponCode ?? `NENLINE-${suffix}`,
  );
}

describe('staging-only Sakamoto friend coupon reset', () => {
  it('resets the one exact blocked test friend and removes only the old issue', () => {
    const db = database();
    insertCandidate(db, 'target');
    insertCandidate(db, 'other', { displayName: '別のお客様' });

    db.exec(migration);

    expect(db.prepare(`SELECT is_following, unfollow_count FROM friends WHERE id = 'friend-target'`).get())
      .toEqual({ is_following: 0, unfollow_count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM nen_friend_add_coupon_issues WHERE id = 'issue-target'`).get())
      .toEqual({ count: 0 });
    expect(db.prepare(`SELECT unfollow_count FROM friends WHERE id = 'friend-other'`).get())
      .toEqual({ unfollow_count: 1 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM nen_friend_add_coupon_issues WHERE id = 'issue-other'`).get())
      .toEqual({ count: 1 });
  });

  it('does nothing when more than one exact candidate exists', () => {
    const db = database();
    insertCandidate(db, 'duplicate-a');
    insertCandidate(db, 'duplicate-b');

    db.exec(migration);

    expect(db.prepare(`SELECT COUNT(*) AS count FROM friends WHERE unfollow_count = 0`).get())
      .toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM nen_friend_add_coupon_issues`).get())
      .toEqual({ count: 2 });
  });

  it('does nothing for a following friend, production account, or new shared code issue', () => {
    const db = database();
    insertCandidate(db, 'following', { isFollowing: 1 });
    insertCandidate(db, 'production', { accountName: '然-NEN- 公式' });
    insertCandidate(db, 'new-code', { couponCode: 'LINEREG5' });

    db.exec(migration);

    expect(db.prepare(`SELECT COUNT(*) AS count FROM friends WHERE unfollow_count = 0`).get())
      .toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM nen_friend_add_coupon_issues`).get())
      .toEqual({ count: 3 });
  });
});
