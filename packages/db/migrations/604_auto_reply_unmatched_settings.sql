-- 草稿。D1への適用にはオーナー承認が必要。
CREATE TABLE auto_reply_unmatched_settings (
 line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
 message TEXT CHECK(message IS NULL OR length(message) BETWEEN 1 AND 5000),
 version INTEGER NOT NULL DEFAULT 1, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
