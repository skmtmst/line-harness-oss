import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getNotificationCenter,
  getNotificationCenterCounts,
  markAllNotificationsRead,
  markNotificationRead,
} from '../src/notifications.js';
import { asD1 } from './d1-test-helper.js';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '197_notification_center_scope.sql'),
  'utf8',
);

function setup(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE notification_rules (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, event_type TEXT NOT NULL,
      conditions TEXT NOT NULL DEFAULT '{}', channels TEXT NOT NULL DEFAULT '["webhook"]',
      is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, rule_id TEXT REFERENCES notification_rules(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, channel TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', metadata TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO line_accounts (id) VALUES ('account-a'), ('account-b');
    INSERT INTO notifications
      (id, event_type, title, body, channel, status, metadata, created_at)
    VALUES ('legacy', 'legacy', '既存通知', '移行前', 'dashboard', 'pending', NULL, '2026-08-01');
  `);
  sqlite.exec(migration);
  return sqlite;
}

describe('migration 197 notification center scope', () => {
  it('keeps legacy notifications unassigned and adds per-staff read storage', () => {
    const sqlite = setup();
    expect(sqlite.prepare('SELECT line_account_id, category FROM notifications WHERE id = ?').get('legacy'))
      .toEqual({ line_account_id: null, category: 'info' });
    expect(sqlite.prepare("PRAGMA index_list('notifications')").all())
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'idx_notifications_center' })]));
    expect(() => sqlite.prepare(`
      INSERT INTO staff_notification_reads (notification_id, staff_id, read_at)
      VALUES ('legacy', 'staff-a', '2026-08-27')
    `).run()).not.toThrow();
  });

  it('isolates accounts and keeps read state separate for each staff member', async () => {
    const sqlite = setup();
    sqlite.exec(`
      INSERT INTO notifications
        (id, event_type, title, body, channel, status, metadata, created_at, line_account_id, category)
      VALUES
        ('error-a', 'health_error', 'エラー', '要確認', 'dashboard', 'pending', '{}', '2026-08-27T10:00:00', 'account-a', 'error'),
        ('update-a', 'release', '更新', '更新あり', 'dashboard', 'pending', NULL, '2026-08-27T09:00:00', 'account-a', 'update'),
        ('email-a', 'mail', 'メール', '対象外', 'email', 'pending', NULL, '2026-08-27T08:00:00', 'account-a', 'error'),
        ('error-b', 'health_error', '別アカウント', '見せない', 'dashboard', 'pending', NULL, '2026-08-27T07:00:00', 'account-b', 'error');
    `);
    const db = asD1(sqlite);

    expect((await getNotificationCenter(db, {
      lineAccountId: 'account-a', staffId: 'staff-a', limit: 20,
    })).map((item) => item.id)).toEqual(['error-a', 'update-a']);
    expect(await getNotificationCenterCounts(db, {
      lineAccountId: 'account-a', staffId: 'staff-a',
    })).toEqual({ all: 2, error: 1, update: 1, unread: 2 });

    expect(await markNotificationRead(db, {
      notificationId: 'error-a', lineAccountId: 'account-a', staffId: 'staff-a',
    })).toBe(true);
    expect(await markNotificationRead(db, {
      notificationId: 'error-b', lineAccountId: 'account-a', staffId: 'staff-a',
    })).toBe(false);
    expect((await getNotificationCenter(db, {
      lineAccountId: 'account-a', staffId: 'staff-a', category: 'error',
    }))[0]?.read_at).not.toBeNull();
    expect((await getNotificationCenterCounts(db, {
      lineAccountId: 'account-a', staffId: 'staff-b',
    })).unread).toBe(2);

    expect(await markAllNotificationsRead(db, {
      lineAccountId: 'account-a', staffId: 'staff-a', category: 'update',
    })).toBe(1);
    expect((await getNotificationCenterCounts(db, {
      lineAccountId: 'account-a', staffId: 'staff-a',
    })).unread).toBe(0);
  });
});
