import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '324_event_waitlist_applicant_contract.sql'),
  'utf8',
);

describe('migration 324 event waitlist and applicant contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT);
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE event_slots (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        capacity INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE event_bookings (
        id TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        slot_id TEXT NOT NULL,
        friend_id TEXT NOT NULL,
        status TEXT NOT NULL,
        customer_note TEXT,
        internal_note TEXT,
        requested_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by_staff_id TEXT,
        cancelled_at TEXT,
        cancelled_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        identity_key TEXT
      );
      CREATE TABLE event_waitlist (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        slot_id TEXT NOT NULL,
        friend_id TEXT NOT NULL,
        identity_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting',
        notified_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_event_waitlist_slot_identity
        ON event_waitlist(slot_id, identity_key);
      CREATE INDEX idx_event_waitlist_slot_created
        ON event_waitlist(slot_id, status, created_at);

      INSERT INTO line_accounts VALUES ('account-a');
      INSERT INTO friends VALUES ('friend-a', 'account-a');
      INSERT INTO events VALUES ('event-a', 'account-a', '相談会', NULL);
      INSERT INTO event_slots VALUES (
        'slot-a', 'event-a', '2026-10-01T00:00:00.000Z', '2026-10-01T01:00:00.000Z',
        3, 1, 0, NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
      );
      INSERT INTO event_bookings VALUES (
        'past', 'account-a', 'event-a', 'slot-a', 'friend-a', 'attended',
        NULL, NULL, '2026-08-01T00:00:00.000Z', NULL, NULL, NULL, NULL,
        '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'friend-a'
      );
      INSERT INTO event_bookings VALUES (
        'current', 'account-a', 'event-a', 'slot-a', 'friend-a', 'confirmed',
        NULL, NULL, '2026-09-01T00:00:00.000Z', NULL, NULL, NULL, NULL,
        '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'friend-a'
      );
      INSERT INTO event_waitlist VALUES (
        'wait-a', 'event-a', 'slot-a', 'friend-a', 'friend-a', 'invited',
        '2026-09-02T00:00:00.000Z', '2026-09-01T12:00:00.000Z'
      );
    `);
    db.exec(migration);
  });

  afterEach(() => db.close());

  test('既存申込へ人数と申込時点の参加回数を安全に補う', () => {
    expect(db.prepare(`
      SELECT party_size, first_participation, first_participation_attended_count,
             first_participation_checked_at
      FROM event_bookings WHERE id = 'current'
    `).get()).toEqual({
      party_size: 1,
      first_participation: 0,
      first_participation_attended_count: 1,
      first_participation_checked_at: '2026-09-01T00:00:00.000Z',
    });
    expect(() => db.prepare(`
      INSERT INTO event_bookings (
        id, line_account_id, event_id, slot_id, friend_id, status, requested_at, party_size
      ) VALUES ('bad', 'account-a', 'event-a', 'slot-a', 'friend-a', 'confirmed', 'now', 0)
    `).run()).toThrow();
  });

  test('旧invitedをofferedへ移し、版・期限・回答の器を持つ', () => {
    expect(db.prepare(`
      SELECT line_account_id, status, party_size, first_participation,
             first_participation_attended_count, version, notified_at
      FROM event_waitlist WHERE id = 'wait-a'
    `).get()).toEqual({
      line_account_id: 'account-a',
      status: 'offered',
      party_size: 1,
      first_participation: 0,
      first_participation_attended_count: 1,
      version: 1,
      notified_at: '2026-09-02T00:00:00.000Z',
    });
  });

  test('終了した待ち履歴は残し、再申込だけを許す', () => {
    db.prepare(`UPDATE event_waitlist SET status = 'expired' WHERE id = 'wait-a'`).run();
    expect(() => db.prepare(`
      INSERT INTO event_waitlist (
        id, line_account_id, event_id, slot_id, friend_id, identity_key, status,
        created_at, updated_at
      ) VALUES (
        'wait-b', 'account-a', 'event-a', 'slot-a', 'friend-a', 'friend-a', 'waiting',
        '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z'
      )
    `).run()).not.toThrow();
    expect(() => db.prepare(`
      INSERT INTO event_waitlist (
        id, line_account_id, event_id, slot_id, friend_id, identity_key, status,
        created_at, updated_at
      ) VALUES (
        'wait-c', 'account-a', 'event-a', 'slot-a', 'friend-a', 'friend-a', 'waiting',
        '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z'
      )
    `).run()).toThrow();
  });

  test('同じ席解放を再試行台帳へ二重登録しない', () => {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO event_waitlist_promotion_jobs (
        id, line_account_id, event_id, slot_id, source_key,
        available_at, created_at, updated_at
      ) VALUES (?, 'account-a', 'event-a', 'slot-a', 'booking:1:cancelled', ?, ?, ?)
    `);
    const at = '2026-09-07T00:00:00.000Z';
    expect(insert.run('job-a', at, at, at).changes).toBe(1);
    expect(insert.run('job-b', at, at, at).changes).toBe(0);
  });
});
