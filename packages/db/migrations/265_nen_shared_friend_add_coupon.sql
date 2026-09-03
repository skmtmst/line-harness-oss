-- NEN: EC-CUBEで事前作成した共通クーポンを、複数の友だちへ1回ずつ案内できるようにする。
-- 友だち単位の重複送信は (line_account_id, friend_id) で引き続き防止する。
CREATE TABLE nen_friend_add_coupon_issues_next (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id       TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  coupon_code     TEXT NOT NULL,
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

INSERT INTO nen_friend_add_coupon_issues_next (
  id, line_account_id, friend_id, coupon_code, discount_rate, valid_from, expires_at,
  status, last_error, issued_at, sent_at, created_at, updated_at
)
SELECT
  id, line_account_id, friend_id, coupon_code, discount_rate, valid_from, expires_at,
  status, last_error, issued_at, sent_at, created_at, updated_at
FROM nen_friend_add_coupon_issues;

DROP TABLE nen_friend_add_coupon_issues;
ALTER TABLE nen_friend_add_coupon_issues_next RENAME TO nen_friend_add_coupon_issues;

CREATE INDEX idx_nen_friend_coupon_status
  ON nen_friend_add_coupon_issues(line_account_id, status, updated_at);
