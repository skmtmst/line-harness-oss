-- NENコラムの対象、予約、読了後の処理と複製元を保存する。
ALTER TABLE nen_columns ADD COLUMN target_mode TEXT NOT NULL DEFAULT 'all'
  CHECK (target_mode IN ('all', 'tag'));
ALTER TABLE nen_columns ADD COLUMN target_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL;
ALTER TABLE nen_columns ADD COLUMN completion_event_name TEXT;
ALTER TABLE nen_columns ADD COLUMN completion_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL;
ALTER TABLE nen_columns ADD COLUMN source_column_id TEXT REFERENCES nen_columns(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS nen_column_read_events (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  column_id TEXT NOT NULL REFERENCES nen_columns(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('opened', 'completed')),
  idempotency_key TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (line_account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_nen_column_read_events_column
  ON nen_column_read_events(line_account_id, column_id, event_kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_nen_column_read_events_friend
  ON nen_column_read_events(friend_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_nen_columns_target_tag
  ON nen_columns(line_account_id, target_tag_id, delivery_status);
