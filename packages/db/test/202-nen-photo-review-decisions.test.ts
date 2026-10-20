import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '202_nen_photo_review_decisions.sql'),
  'utf8',
);

function setup(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE nen_photo_submissions (id TEXT PRIMARY KEY);
    INSERT INTO line_accounts VALUES ('account-a');
    INSERT INTO nen_photo_submissions VALUES ('photo-a');
  `);
  sqlite.exec(migration);
  return sqlite;
}

describe('migration 202 NEN photo review decisions', () => {
  it('records the reason, reviewer and notification result', () => {
    const sqlite = setup();
    sqlite.prepare(`INSERT INTO nen_photo_review_events
      (id, photo_id, line_account_id, from_status, to_status, reason_code, reason_note,
       awarded_points, reviewed_by, reviewed_by_name, notification_status, created_at, updated_at)
      VALUES ('event-a', 'photo-a', 'account-a', 'pending', 'rejected', 'privacy',
       '人の顔が写っています', 0, 'env-owner', '環境所有者', 'failed', '2026-08-28', '2026-08-28')`).run();
    expect(sqlite.prepare(`SELECT to_status, reason_code, reviewed_by, reviewed_by_name,
      notification_status, notification_attempt_count
      FROM nen_photo_review_events`).get()).toEqual({
      to_status: 'rejected', reason_code: 'privacy', reviewed_by: 'env-owner',
      reviewed_by_name: '環境所有者', notification_status: 'failed', notification_attempt_count: 0,
    });
  });

  it('allows only one decision from the pending state', () => {
    const sqlite = setup();
    const insert = sqlite.prepare(`INSERT INTO nen_photo_review_events
      (id, photo_id, line_account_id, from_status, to_status, awarded_points, reviewed_by,
       reviewed_by_name, notification_status, created_at, updated_at)
      VALUES (?, 'photo-a', 'account-a', 'pending', ?, 0, 'staff-a', '担当者', 'pending', '2026-08-28', '2026-08-28')`);
    insert.run('event-a', 'rejected');
    expect(() => insert.run('event-b', 'adopted')).toThrow();
  });

  it('rejects unknown notification states', () => {
    const sqlite = setup();
    expect(() => sqlite.prepare(
      "UPDATE nen_photo_submissions SET review_notification_status = 'unknown' WHERE id = 'photo-a'",
    ).run()).toThrow();
  });

  it('rejects unknown reason codes at the database boundary', () => {
    const sqlite = setup();
    expect(() => sqlite.prepare(
      "UPDATE nen_photo_submissions SET review_reason_code = 'toString' WHERE id = 'photo-a'",
    ).run()).toThrow();
  });
});
