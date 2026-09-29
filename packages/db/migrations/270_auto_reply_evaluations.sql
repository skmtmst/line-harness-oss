-- V6 8-1-H: 自動応答を「何に当たり、何を実行し、どこで止まったか」まで辿る。
--
-- auto_reply_hits は既存集計との互換用に残す。この台帳は受信イベント単位の
-- 評価・返信・後続処理を記録し、Webhook再送でも同じイベントを二重実行しない。

CREATE TABLE IF NOT EXISTS auto_reply_versions (
  id                    TEXT PRIMARY KEY,
  auto_reply_id         TEXT NOT NULL,
  version_number        INTEGER NOT NULL,
  line_account_id       TEXT,
  definition_snapshot   TEXT NOT NULL CHECK (json_valid(definition_snapshot)),
  status                TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'published', 'retired')),
  published_at          TEXT,
  published_by_staff_id TEXT,
  created_at            TEXT NOT NULL,
  UNIQUE (auto_reply_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_auto_reply_versions_current
  ON auto_reply_versions (auto_reply_id, version_number DESC);

CREATE TABLE IF NOT EXISTS auto_reply_evaluations (
  id                       TEXT PRIMARY KEY,
  incoming_event_id        TEXT NOT NULL UNIQUE,
  incoming_message_log_id  TEXT,
  line_account_id          TEXT,
  friend_id                TEXT NOT NULL,
  message_kind             TEXT NOT NULL,
  normalized_text_hash     TEXT NOT NULL,
  input_preview_masked     TEXT,
  evaluated_at             TEXT NOT NULL,
  completed_at             TEXT,
  winning_auto_reply_id    TEXT,
  winning_version_id       TEXT,
  status                   TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN (
      'received', 'evaluated', 'matched', 'skipped', 'reply_accepted',
      'reply_failed', 'actions_running', 'completed', 'partial_failed', 'failed'
    )),
  skip_reason              TEXT,
  matched_keyword          TEXT,
  reply_status             TEXT NOT NULL DEFAULT 'not_attempted'
    CHECK (reply_status IN ('not_attempted', 'accepted', 'failed')),
  line_request_id          TEXT,
  message_log_id           TEXT,
  action_summary           TEXT CHECK (action_summary IS NULL OR json_valid(action_summary)),
  error_code               TEXT,
  duration_ms              INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auto_reply_evaluations_account_time
  ON auto_reply_evaluations (line_account_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_auto_reply_evaluations_rule_time
  ON auto_reply_evaluations (winning_auto_reply_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_auto_reply_evaluations_status_time
  ON auto_reply_evaluations (status, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS auto_reply_evaluation_details (
  id                 TEXT PRIMARY KEY,
  evaluation_id      TEXT NOT NULL,
  auto_reply_id      TEXT NOT NULL,
  rule_version_id    TEXT,
  evaluation_order   INTEGER NOT NULL,
  result             TEXT NOT NULL CHECK (result IN ('not_matched', 'skipped', 'won')),
  reason_codes_json  TEXT NOT NULL CHECK (json_valid(reason_codes_json)),
  created_at         TEXT NOT NULL,
  UNIQUE (evaluation_id, auto_reply_id)
);

CREATE INDEX IF NOT EXISTS idx_auto_reply_evaluation_details_evaluation
  ON auto_reply_evaluation_details (evaluation_id, evaluation_order);

CREATE TABLE IF NOT EXISTS auto_reply_action_runs (
  id                  TEXT PRIMARY KEY,
  evaluation_id       TEXT NOT NULL,
  action_stable_id    TEXT NOT NULL,
  action_version      INTEGER NOT NULL DEFAULT 1,
  action_type         TEXT NOT NULL,
  action_snapshot     TEXT NOT NULL CHECK (json_valid(action_snapshot)),
  idempotency_key     TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'claimed', 'succeeded', 'skipped',
      'retry_wait', 'permanent_failed', 'cancelled'
    )),
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_error_code     TEXT,
  result_json         TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  started_at          TEXT,
  completed_at        TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (evaluation_id, action_stable_id)
);

CREATE INDEX IF NOT EXISTS idx_auto_reply_action_runs_evaluation
  ON auto_reply_action_runs (evaluation_id, status);
