-- 一斉配信の送信後動作の実行台帳 (P1-06)。
--
-- 送信後動作（タグ付け等）は各宛先の送信受理後に実行し、失敗した宛先には
-- 実行しない。受理 (broadcast_send_claims = 'sent') を確認してから1行ずつ
-- 取り、(broadcast_id, friend_id, action_id) の一意制約で二重実行を防ぐ。
-- 失敗は試行回数の上限 (max_attempts) で打ち止めにする。

CREATE TABLE IF NOT EXISTS broadcast_after_action_runs (
  id                       TEXT PRIMARY KEY,
  broadcast_id             TEXT NOT NULL REFERENCES broadcasts (id) ON DELETE CASCADE,
  friend_id                TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  common_action_version_id TEXT NOT NULL,
  action_id                TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempt_count            INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts             INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  error_code               TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (broadcast_id, friend_id, action_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_after_action_runs_due
  ON broadcast_after_action_runs (status, updated_at);
