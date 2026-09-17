-- migration-policy: table-rebuild
-- 共通情報の解決失敗を記録する台帳が、一斉配信以外の送信経路を区別して残せる
-- ようにする。シナリオ・初回配信・リマインド・フォーム返信・自動応答・
-- テスト送信・個別送信の各経路で、解決できなかった共通情報の名前と理由を
-- 残す。併せて「直せば再送できる失敗か」を retryable 列で明示する。
-- 既存行はそのまま引き継ぎ、共通情報の解決失敗はすべて修復後に再送できる
-- 性質のものなので retryable=1 で埋める。

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
  -- 1 = 共通情報を直せば同じ送信を重複なく再試行できる。0 = 再試行しても
  -- 治らない失敗（今のところ解決失敗はすべて 1。将来の恒久的失敗用の印）。
  retryable       INTEGER NOT NULL DEFAULT 1 CHECK (retryable IN (0, 1)),
  execution_at    TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  UNIQUE(source_kind, source_id, var_key, execution_at)
);

INSERT INTO common_var_resolution_failures_new (
  id, line_account_id, source_kind, source_id, var_key, reason, retryable, execution_at, created_at
)
SELECT
  id, line_account_id, source_kind, source_id, var_key, reason, 1, execution_at, created_at
FROM common_var_resolution_failures;

DROP TABLE common_var_resolution_failures;

ALTER TABLE common_var_resolution_failures_new RENAME TO common_var_resolution_failures;

-- 表の再構築前と同じ索引名だと適用判定で飛ばされるため、423 固有名で貼り直す。
CREATE INDEX idx_common_var_resolution_failures_source_v423
  ON common_var_resolution_failures(source_kind, source_id, created_at DESC);
