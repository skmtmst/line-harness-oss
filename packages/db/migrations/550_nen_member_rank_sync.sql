-- ランク削除時の会員別送信を、会員の移し替えと同時に保存する。
CREATE TABLE IF NOT EXISTS nen_member_rank_sync (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  friend_id TEXT NOT NULL,
  customer_id TEXT,
  rank_key TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  expected_version INTEGER CHECK (expected_version IS NULL OR expected_version >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'failed', 'synced')),
  error_code TEXT,
  error_reason TEXT,
  result_version INTEGER,
  duplicate INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (operation_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_nen_member_rank_sync_operation
  ON nen_member_rank_sync(line_account_id, operation_id, status);
