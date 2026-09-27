-- 486: 高額マイル調整の二者承認の依頼票。
-- 付け足すだけ（CREATE TABLE・CREATE INDEX）。依頼票は削除しない。
CREATE TABLE IF NOT EXISTS mileage_adjustment_approval_requests (
  id                     TEXT PRIMARY KEY,
  line_account_id        TEXT NOT NULL,
  program_id             TEXT NOT NULL DEFAULT 'default',
  friend_id              TEXT NOT NULL,
  direction              TEXT NOT NULL CHECK (direction IN ('increase', 'decrease')),
  amount                 INTEGER NOT NULL CHECK (amount > 0),
  reason_category        TEXT NOT NULL,
  reason                 TEXT NOT NULL,
  source_reference_id    TEXT,
  expires_at             TEXT,
  notify_friend          INTEGER NOT NULL DEFAULT 0,
  idempotency_key        TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by_staff_id  TEXT NOT NULL,
  requested_by_staff_name TEXT NOT NULL,
  decided_by_staff_id    TEXT,
  decided_by_staff_name  TEXT,
  decided_at             TEXT,
  decision_reason        TEXT,
  ledger_entry_id        TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_mileage_adj_approval_account
  ON mileage_adjustment_approval_requests (line_account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mileage_adj_approval_friend
  ON mileage_adjustment_approval_requests (friend_id, created_at DESC);
