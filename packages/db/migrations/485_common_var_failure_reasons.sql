-- migration-policy: table-rebuild
-- Q（機能）: 解決失敗の台帳に「止めた」「下書き」の理由を足す。止めた・下書きの
-- 共通情報は差し込みに答えられないので、配信を止めて運用者へ知らせる失敗として
-- 記録する。表の形は 423 のまま（送信経路の区別と retryable をそのまま引き継ぐ）。
CREATE TABLE common_var_resolution_failures_new (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  source_kind     TEXT NOT NULL CHECK (source_kind IN (
    'broadcast', 'scenario', 'first_step', 'reminder',
    'form_reply', 'auto_reply', 'test_send', 'chat',
    'automation', 'friend_direct', 'rich_menu_tap', 'carousel_tap', 'liff',
    'notification'
  )),
  source_id       TEXT NOT NULL,
  var_key         TEXT NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('missing', 'not_started', 'expired', 'fallback_missing', 'invalid_window', 'stopped', 'draft')),
  retryable       INTEGER NOT NULL DEFAULT 1 CHECK (retryable IN (0, 1)),
  execution_at    TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  UNIQUE(source_kind, source_id, var_key, execution_at)
);

INSERT INTO common_var_resolution_failures_new (
  id, line_account_id, source_kind, source_id, var_key, reason, retryable, execution_at, created_at
)
SELECT
  id, line_account_id, source_kind, source_id, var_key, reason, retryable, execution_at, created_at
FROM common_var_resolution_failures;

DROP TABLE common_var_resolution_failures;

ALTER TABLE common_var_resolution_failures_new RENAME TO common_var_resolution_failures;

-- 表の再構築前と同じ索引名だと適用判定で飛ばされるため、485 固有名で貼り直す。
CREATE INDEX idx_common_var_resolution_failures_source_v485
  ON common_var_resolution_failures(source_kind, source_id, created_at DESC);
