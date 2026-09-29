import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '../migrations/341_ec_notification_settings_account_scope.sql'),
  'utf8',
);

describe('341 EC notification settings account scope migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE ec_notification_settings (
        event_type TEXT PRIMARY KEY,
        is_enabled INTEGER NOT NULL,
        title_override TEXT,
        intro_text TEXT,
        outro_text TEXT,
        category TEXT NOT NULL,
        button_label TEXT,
        button_url TEXT,
        image_url TEXT,
        display_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO line_accounts (id) VALUES ('account-1'), ('account-2');
      INSERT INTO ec_notification_settings
        (event_type, is_enabled, title_override, intro_text, outro_text, category,
         button_label, button_url, image_url, display_order, created_at, updated_at)
      VALUES ('ec.order.confirmed', 1, '注文通知', 'ありがとうございます', '以上です',
              'order', '注文を見る', NULL, NULL, 10, 'created', 'updated');
    `);
  });

  afterEach(() => db.close());

  it('現在値を全アカウントへ複製し、以後は複合キーで別々に保存する', () => {
    db.exec(migration);
    expect(db.prepare(`
      SELECT line_account_id, event_type, title_override
        FROM ec_notification_account_settings ORDER BY line_account_id
    `).all()).toEqual([
      { line_account_id: 'account-1', event_type: 'ec.order.confirmed', title_override: '注文通知' },
      { line_account_id: 'account-2', event_type: 'ec.order.confirmed', title_override: '注文通知' },
    ]);

    db.prepare(`
      UPDATE ec_notification_account_settings SET title_override = '店舗1の注文通知'
       WHERE line_account_id = 'account-1' AND event_type = 'ec.order.confirmed'
    `).run();
    expect(db.prepare(`
      SELECT line_account_id, title_override
        FROM ec_notification_account_settings ORDER BY line_account_id
    `).all()).toEqual([
      { line_account_id: 'account-1', title_override: '店舗1の注文通知' },
      { line_account_id: 'account-2', title_override: '注文通知' },
    ]);
  });
});
