-- LINE公式アカウント準拠の一斉配信作成UI用データ。
-- 既存の単一メッセージ配信は残し、複数吹き出しは追加JSON列へ保存する。
ALTER TABLE broadcasts ADD COLUMN message_bubbles_json TEXT
  CHECK (message_bubbles_json IS NULL OR json_valid(message_bubbles_json));

CREATE TABLE IF NOT EXISTS broadcast_message_assets (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('rich_message', 'card_message', 'coupon', 'research')),
  name            TEXT NOT NULL,
  payload_json    TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_broadcast_message_assets_account_kind
  ON broadcast_message_assets(line_account_id, kind, updated_at DESC);
