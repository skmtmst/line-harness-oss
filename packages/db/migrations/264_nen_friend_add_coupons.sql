-- NEN: LINE友だち追加時に、同じ友だちへクーポンを重複発行しないための台帳。
CREATE TABLE IF NOT EXISTS nen_friend_add_coupon_issues (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id       TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  coupon_code     TEXT NOT NULL UNIQUE,
  discount_rate   INTEGER NOT NULL CHECK (discount_rate BETWEEN 1 AND 100),
  valid_from      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'coupon_created', 'sent', 'failed_create', 'failed_send')),
  last_error      TEXT,
  issued_at       TEXT,
  sent_at         TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (line_account_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_nen_friend_coupon_status
  ON nen_friend_add_coupon_issues(line_account_id, status, updated_at);
