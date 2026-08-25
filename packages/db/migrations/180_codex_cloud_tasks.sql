-- Slack実メンションをイベント駆動で追跡するための最小台帳。
-- 依頼本文は保存せず、Slack/ChatGPTの識別子と進行状態だけを保持する。
CREATE TABLE IF NOT EXISTS codex_cloud_tasks (
  slack_event_id               TEXT PRIMARY KEY,
  team_id                      TEXT NOT NULL,
  channel_id                   TEXT NOT NULL,
  message_ts                   TEXT NOT NULL,
  thread_ts                    TEXT NOT NULL,
  requester_user_id            TEXT NOT NULL,
  status                       TEXT NOT NULL DEFAULT 'detected'
                                 CHECK (status IN (
                                   'detected',
                                   'official_running',
                                   'official_failed',
                                   'fallback_starting',
                                   'fallback_running',
                                   'fallback_suspended',
                                   'duplicate_risk',
                                   'completed',
                                   'failed'
                                 )),
  official_task_url            TEXT,
  fallback_run_id              TEXT,
  fallback_conversation_url    TEXT,
  detected_at                  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (channel_id, message_ts)
);

CREATE INDEX IF NOT EXISTS idx_codex_cloud_tasks_thread
  ON codex_cloud_tasks(channel_id, thread_ts, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_codex_cloud_tasks_status
  ON codex_cloud_tasks(status, updated_at DESC);
