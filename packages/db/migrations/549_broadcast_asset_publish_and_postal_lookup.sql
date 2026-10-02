-- F4 配信用素材の公開・下書き・版・フォルダ（templates と同じ形）。
-- F11 郵便番号→住所の参照表（日本郵便の公開データ用）。
--
-- 既存の素材行は公開版として残す（公開版1・下書きなし）。
-- 素材の置き場は独立表にする。既存foldersはDROP/RENAMEしない。
-- D1は全migrationをFK有効の暗黙transactionで実行するため、DROP TABLE foldersは
-- 参照をSET NULL/CASCADEする。transaction中のforeign_keys切替は不可、deferでも
-- CASCADEは止まらない。公式 https://developers.cloudflare.com/d1/sql-api/foreign-keys/
-- 適用は番号ごとの明示承認後。
CREATE TABLE IF NOT EXISTS broadcast_asset_folders (
  id TEXT PRIMARY KEY,
  line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_broadcast_asset_folders_account
  ON broadcast_asset_folders(line_account_id, display_order);

ALTER TABLE broadcast_message_assets ADD COLUMN folder_id TEXT REFERENCES broadcast_asset_folders(id) ON DELETE SET NULL;
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

-- 取り込みの完了記録。readinessは件数だけで真にせず、この記録と突き合わせる。
-- 部分・試し取り込みは全国対応と名乗らない。
CREATE TABLE IF NOT EXISTS postal_import_manifest (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  input_sha256 TEXT NOT NULL,
  input_bytes INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  imported_at TEXT NOT NULL
);
