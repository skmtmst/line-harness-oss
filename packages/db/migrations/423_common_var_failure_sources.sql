-- migration-policy: table-rebuild
-- 共通情報の解決失敗を記録する台帳が、一斉配信以外の送信経路を区別して残せる
-- ようにする。シナリオ・初回配信・リマインド・フォーム返信・自動応答・
-- テスト送信・個別送信の各経路で、解決できなかった共通情報の名前と理由を
-- 残す。既存行はそのまま引き継ぐ。

CREATE TABLE common_var_resolution_failures_new (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  source_kind     TEXT NOT NULL CHECK (source_kind IN (
    'broadcast', 'scenario', 'first_step', 'reminder',
    'form_reply', 'auto_reply', 'test_send', 'chat'
  )),
  source_id       TEXT NOT NULL,
  var_key         TEXT NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('missing', 'not_started', 'expired', 'fallback_missing', 'invalid_window')),
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

-- 表の再構築前と同じ索引名だと適用判定で飛ばされるため、423 固有名で貼り直す。
CREATE INDEX idx_common_var_resolution_failures_source_v423
  ON common_var_resolution_failures(source_kind, source_id, created_at DESC);
