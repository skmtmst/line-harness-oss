-- migration-policy: table-rebuild
-- F4 配信用素材の公開・下書き・版・フォルダ（templates と同じ形）。
-- F11 郵便番号→住所の参照表（日本郵便の公開データ用）。
--
-- 既存の素材行は公開版として残す（公開版1・下書きなし）。
-- `folders.kind` は CHECK なので、素材用の置き場を足すために表を作り直す。
-- 適用は番号ごとの明示承認後。
CREATE TABLE folders_new (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'tag','template','scenario','reminder','auto_reply',
                  'rich_menu','webinar','form','media','common_var',
                  'mileage_rule','automation','event','entry_route','broadcast',
                  'broadcast_message_asset')),
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES folders(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  color         TEXT,
  account_id    TEXT REFERENCES line_accounts(id) ON DELETE CASCADE
);

INSERT INTO folders_new (id, kind, name, parent_id, display_order, created_at, updated_at, color, account_id)
SELECT id, kind, name, parent_id, display_order, created_at, updated_at, color, account_id FROM folders;

DROP TABLE folders;
ALTER TABLE folders_new RENAME TO folders;

CREATE INDEX IF NOT EXISTS idx_folders_kind_order_549 ON folders(kind, display_order);

ALTER TABLE broadcast_message_assets ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE broadcast_message_assets ADD COLUMN published_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE broadcast_message_assets ADD COLUMN published_at TEXT;
ALTER TABLE broadcast_message_assets ADD COLUMN draft_payload_json TEXT CHECK (draft_payload_json IS NULL OR json_valid(draft_payload_json));
ALTER TABLE broadcast_message_assets ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 0;

UPDATE broadcast_message_assets
   SET published_version = 1,
       published_at = updated_at
 WHERE published_version = 0;

CREATE TABLE IF NOT EXISTS broadcast_asset_versions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES broadcast_message_assets(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_by_staff_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (asset_id, version_number)
);

CREATE TABLE IF NOT EXISTS broadcast_asset_publish_keys (
  asset_id TEXT NOT NULL REFERENCES broadcast_message_assets(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  published_version INTEGER NOT NULL,
  draft_revision INTEGER NOT NULL,
  draft_fingerprint TEXT NOT NULL DEFAULT '',
  payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_asset_versions_asset
  ON broadcast_asset_versions(asset_id, version_number DESC);

-- 日本郵便の公開郵便番号データの取り込み先。利用時の検索はこの表を読む。
-- 7桁は文字列で持つ（先頭0を保つ）。同じ番号に複数行あり得る。
-- 取り込み前は0件で、口は readiness.fullDataset=false を名乗る。
CREATE TABLE IF NOT EXISTS postal_codes (
  postal_code TEXT NOT NULL,
  prefecture TEXT NOT NULL,
  city TEXT NOT NULL,
  town TEXT NOT NULL DEFAULT '',
  source_name TEXT,
  imported_at TEXT,
  PRIMARY KEY (postal_code, prefecture, city, town)
);

CREATE INDEX IF NOT EXISTS idx_postal_codes_code
  ON postal_codes(postal_code);
