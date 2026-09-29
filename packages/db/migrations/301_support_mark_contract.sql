-- 対応マークの複合作成・競合検査・冪等な置換保管に必要な状態を追加する。
ALTER TABLE support_marks ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE support_marks ADD COLUMN updated_at TEXT;
ALTER TABLE support_marks ADD COLUMN created_by TEXT;
ALTER TABLE support_marks ADD COLUMN updated_by TEXT;

UPDATE support_marks SET updated_at = created_at WHERE updated_at IS NULL;

CREATE TABLE IF NOT EXISTS support_mark_archive_requests (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id),
  mark_id           TEXT NOT NULL REFERENCES support_marks(id),
  idempotency_key   TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  response_json     TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at        TEXT NOT NULL,
  UNIQUE(line_account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_support_mark_archive_requests_mark
  ON support_mark_archive_requests(line_account_id, mark_id, created_at DESC);
