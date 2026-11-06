import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('migration 549は既存foldersをDROPしない', () => {
  it('明示transaction＋FK ONで既存kind・親子・参照・索引を保持する', () => {
    const db = new Database(':memory:');
    try {
      // D1と同条件にする。transaction外のexecではD1境界を証明しない。
      db.pragma('foreign_keys = ON');
      db.exec(`CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
        CREATE TABLE folders (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN (
            'tag','template','scenario','reminder','auto_reply',
            'rich_menu','webinar','form','media','common_var',
            'mileage_rule','automation','event','entry_route','broadcast')),
          name TEXT NOT NULL,
          parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
          display_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT '2026-10-02',
          updated_at TEXT NOT NULL DEFAULT '2026-10-02',
          color TEXT,
          account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_folders_kind_order ON folders(kind, display_order);
        CREATE TABLE broadcasts (id TEXT PRIMARY KEY, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL);
        CREATE TABLE templates (id TEXT PRIMARY KEY, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL);
        CREATE TABLE broadcast_message_assets (
          id TEXT PRIMARY KEY,
          line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('rich_message', 'card_message', 'coupon', 'research')),
          name TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO line_accounts (id) VALUES ('account-1');
        INSERT INTO folders (id, kind, name, parent_id, account_id) VALUES
          ('parent-1', 'template', '親', NULL, 'account-1'),
          ('child-1', 'template', '子', 'parent-1', 'account-1'),
          ('broadcast-1', 'broadcast', '配信置き場', NULL, 'account-1'),
          ('tag-1', 'tag', '分類', NULL, NULL);
        INSERT INTO broadcasts (id, folder_id) VALUES ('broadcast-row-1', 'broadcast-1');
        INSERT INTO templates (id, folder_id) VALUES ('template-row-1', 'parent-1');`);
      db.exec('BEGIN');
      try {
        db.exec(readFileSync(new URL('../migrations/549_broadcast_asset_publish_and_postal_lookup.sql', import.meta.url), 'utf8'));
        db.exec('COMMIT');
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch { /* 巻き戻し自体の失敗は無視する */ }
        throw err;
      }
      // 既存行・親子・参照がそのまま残る。friend_fieldは旧CHECKにも無いため対象外。
      expect(db.prepare('SELECT id, kind FROM folders ORDER BY id').all()).toEqual([
        { id: 'broadcast-1', kind: 'broadcast' },
        { id: 'child-1', kind: 'template' },
        { id: 'parent-1', kind: 'template' },
        { id: 'tag-1', kind: 'tag' },
      ]);
      expect(db.prepare('SELECT parent_id AS p FROM folders WHERE id = ?').get('child-1')).toEqual({ p: 'parent-1' });
      expect(db.prepare('SELECT folder_id AS f FROM broadcasts WHERE id = ?').get('broadcast-row-1')).toEqual({ f: 'broadcast-1' });
      expect(db.prepare('SELECT folder_id AS f FROM templates WHERE id = ?').get('template-row-1')).toEqual({ f: 'parent-1' });
      // 既存索引が残る。
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_folders_kind_order'").get()).toBeTruthy();
      // 素材の置き場は独立表に入る。
      db.prepare("INSERT INTO broadcast_asset_folders (id, line_account_id, name, display_order, created_at, updated_at) VALUES ('asset-1', 'account-1', '素材', 0, '2026-10-02', '2026-10-02')").run();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'broadcast_asset_folders'").get()).toBeTruthy();
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('migration 549 素材の公開版と郵便番号表', () => {
  it('旧行を公開版1・下書きなしで残し、新表を作る', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      db.exec(`CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
        CREATE TABLE folders (id TEXT PRIMARY KEY, kind TEXT NOT NULL, account_id TEXT, name TEXT NOT NULL DEFAULT 'f', parent_id TEXT, display_order INTEGER NOT NULL DEFAULT 0, color TEXT, created_at TEXT NOT NULL DEFAULT '2026-10-02', updated_at TEXT NOT NULL DEFAULT '2026-10-02');
        CREATE TABLE broadcast_message_assets (
          id TEXT PRIMARY KEY,
          line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('rich_message', 'card_message', 'coupon', 'research')),
          name TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO line_accounts (id) VALUES ('account-1');
        INSERT INTO broadcast_message_assets (id, line_account_id, kind, name, payload_json, created_at, updated_at)
          VALUES ('old-1', 'account-1', 'coupon', '旧素材', '{"title":"旧"}', '2026-09-01T00:00:00+09:00', '2026-09-02T00:00:00+09:00');`);
      db.exec(readFileSync(new URL('../migrations/549_broadcast_asset_publish_and_postal_lookup.sql', import.meta.url), 'utf8'));
      const row = db.prepare('SELECT published_version, published_at, draft_payload_json, draft_revision, folder_id FROM broadcast_message_assets WHERE id = ?').get('old-1') as Record<string, unknown>;
      expect(row).toMatchObject({
        published_version: 1,
        published_at: '2026-09-02T00:00:00+09:00',
        draft_payload_json: null,
        draft_revision: 0,
        folder_id: null,
      });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'broadcast_asset_versions'").get()).toBeTruthy();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'broadcast_asset_publish_keys'").get()).toBeTruthy();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'postal_codes'").get()).toBeTruthy();
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });
});
