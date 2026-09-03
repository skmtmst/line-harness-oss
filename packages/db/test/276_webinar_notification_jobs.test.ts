import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '276_webinar_notification_jobs.sql'),
  'utf8',
);

describe('276_webinar_notification_jobs migration', () => {
  test('既存申込を有効のまま残し、設定と通知ジョブを追加する', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE webinars (id TEXT PRIMARY KEY);
      CREATE TABLE friends (id TEXT PRIMARY KEY);
      CREATE TABLE webinar_registrations (
        id TEXT PRIMARY KEY,
        webinar_id TEXT NOT NULL REFERENCES webinars(id),
        friend_id TEXT NOT NULL REFERENCES friends(id),
        session_start_at INTEGER NOT NULL,
        notified_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(webinar_id, friend_id, session_start_at)
      );
      INSERT INTO webinars VALUES ('webinar-1');
      INSERT INTO friends VALUES ('friend-1');
      INSERT INTO webinar_registrations
        VALUES ('registration-1', 'webinar-1', 'friend-1', 1000, NULL, '2026-09-04T00:00:00.000Z');
    `);

    db.exec(migration);

    expect(db.prepare(
      `SELECT status, cancelled_at FROM webinar_registrations WHERE id='registration-1'`,
    ).get()).toEqual({ status: 'active', cancelled_at: null });
    expect(db.prepare(
      `SELECT name FROM sqlite_master
        WHERE type='table' AND name IN ('webinar_notification_settings','webinar_notification_jobs')
        ORDER BY name`,
    ).all()).toEqual([
      { name: 'webinar_notification_jobs' },
      { name: 'webinar_notification_settings' },
    ]);
  });
});
