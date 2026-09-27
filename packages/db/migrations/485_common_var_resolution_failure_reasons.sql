-- migration-policy: table-rebuild
-- Q（機能）: 解決失敗の台帳に「止めた」「下書き」を足す。止めた・下書きの共通情報は
-- 差し込みに答えられないので、配信を止めて運用者へ知らせる失敗として記録する。
CREATE TABLE common_var_resolution_failures_new (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  source_kind     TEXT NOT NULL CHECK (source_kind IN ('broadcast')),
  source_id       TEXT NOT NULL,
  var_key         TEXT NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('missing', 'not_started', 'expired', 'fallback_missing', 'invalid_window', 'stopped', 'draft')),
  execution_at    TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  UNIQUE(source_kind, source_id, var_key, execution_at)
);

INSERT INTO common_var_resolution_failures_new (
  id, line_account_id, source_kind, source_id, var_key, reason, execution_at, created_at
)
SELECT
  id, line_account_id, source_kind, source_id, var_key, reason, execution_at, created_at
FROM common_var_resolution_failures;

DROP TABLE common_var_resolution_failures;
ALTER TABLE common_var_resolution_failures_new RENAME TO common_var_resolution_failures;

CREATE INDEX idx_common_var_resolution_failures_source
  ON common_var_resolution_failures(source_kind, source_id, created_at DESC);
