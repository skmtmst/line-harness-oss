import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
