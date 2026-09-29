-- 機能17 第3周: 付与ルールのアカウント別下書きと手動調整通知の監査。
-- 既存の公開ルール・マイル台帳は書き換えず、未所属の旧ルールを推測で
-- LINEアカウントへ割り当てない。

CREATE TABLE IF NOT EXISTS mileage_earning_rule_drafts (
  rule_id             TEXT PRIMARY KEY REFERENCES mileage_rules(id),
  line_account_id     TEXT NOT NULL REFERENCES line_accounts(id),
  version             INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  draft_json          TEXT NOT NULL CHECK (json_valid(draft_json)),
  updated_by_staff_id TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mileage_earning_rule_drafts_account
  ON mileage_earning_rule_drafts(line_account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS mileage_adjustment_notifications (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id),
  friend_id         TEXT NOT NULL REFERENCES friends(id),
  ledger_entry_id   TEXT NOT NULL UNIQUE REFERENCES mileage_ledger(id),
  idempotency_key   TEXT NOT NULL,
  message_text      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count     INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  line_request_id   TEXT,
  error_code        TEXT,
  first_failed_at   TEXT,
  sent_at           TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (line_account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_mileage_adjustment_notifications_retry
  ON mileage_adjustment_notifications(status, updated_at)
  WHERE status = 'failed';
