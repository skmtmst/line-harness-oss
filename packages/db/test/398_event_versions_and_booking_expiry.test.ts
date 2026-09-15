import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '../migrations/398_event_versions_and_booking_expiry.sql'),
  'utf8',
);

function legacyDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      line_account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      image_url TEXT,
      description TEXT,
      venue_name TEXT,
      venue_url TEXT,
      cancel_deadline_hours_before INTEGER,
      confirmation_message_extra TEXT,
      updated_at TEXT,
      is_published INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    );
    CREATE TABLE event_slots (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL
    );
    CREATE TABLE event_bookings (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL
    );
    CREATE TABLE event_waitlist (id TEXT PRIMARY KEY);
  `);
  return db;
}

describe('migration 398 event versions and booking expiry', () => {
  test('legacy公開イベントと予約を24時間契約の版・申込時点snapshotへ移す', () => {
    const db = legacyDb();
    db.prepare(`INSERT INTO line_accounts (id) VALUES ('account-1')`).run();
    db.prepare(
      `INSERT INTO events
         (id, line_account_id, name, image_url, description, venue_name, venue_url,
          cancel_deadline_hours_before, confirmation_message_extra, updated_at, is_published)
       VALUES ('event-1', 'account-1', '旧イベント', NULL, '旧説明', '旧会場', NULL,
               3, '旧確認文', '2026-09-01T00:00:00.000Z', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO event_slots (id, event_id, starts_at, ends_at)
       VALUES ('slot-1', 'event-1', '2026-10-01T01:00:00.000Z', '2026-10-01T02:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO event_bookings (id, event_id, slot_id, status, requested_at)
       VALUES ('booking-1', 'event-1', 'slot-1', 'requested', '2026-09-10T01:02:03.000Z')`,
    ).run();

    db.exec(migration);

    expect(db.prepare(
      `SELECT version, current_published_version_id, approval_deadline_hours FROM events WHERE id = 'event-1'`,
    ).get()).toEqual({
      version: 1,
      current_published_version_id: 'event-version:event-1:1',
      approval_deadline_hours: 24,
    });
    expect(db.prepare(
      `SELECT version_number, approval_deadline_hours,
              json_extract(snapshot_json, '$.eventName') AS event_name
         FROM event_versions WHERE event_id = 'event-1'`,
    ).get()).toEqual({
      version_number: 1,
      approval_deadline_hours: 24,
      event_name: '旧イベント',
    });
    expect(db.prepare(
      `SELECT event_version_id, approval_expires_at,
              json_extract(event_snapshot_json, '$.eventName') AS event_name,
              json_extract(event_snapshot_json, '$.slotStartsAt') AS slot_starts_at
         FROM event_bookings WHERE id = 'booking-1'`,
    ).get()).toEqual({
      event_version_id: 'event-version:event-1:1',
      approval_expires_at: '2026-09-11T01:02:03.000Z',
      event_name: '旧イベント',
      slot_starts_at: '2026-10-01T01:00:00.000Z',
    });
    expect(() => db.prepare(
      `UPDATE events SET approval_deadline_hours = 12 WHERE id = 'event-1'`,
    ).run()).toThrow();
    db.close();
  });
});
