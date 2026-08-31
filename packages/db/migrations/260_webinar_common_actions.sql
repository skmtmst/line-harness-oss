-- V6 ウェビナーの視聴後アクション。
--
-- 共通アクションの公開版を利用箇所ごとに固定し、実行そのものは既存の
-- automation_runs / automation_run_steps へ接続する。視聴イベントを失わず、
-- 同じ人・同じ回・同じきっかけは一度だけ開始する。

CREATE TABLE IF NOT EXISTS webinar_actions (
  webinar_id                  TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  trigger_type                TEXT NOT NULL CHECK (trigger_type IN (
                                'completed', 'cta_click', 'missed'
                              )),
  version                     INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  operation_token             TEXT NOT NULL,
  common_action_id            TEXT REFERENCES common_actions(id),
  common_action_version_id    TEXT REFERENCES common_action_versions(id),
  updated_by                  TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  PRIMARY KEY (webinar_id, trigger_type),
  CHECK (
    (common_action_id IS NULL AND common_action_version_id IS NULL)
    OR (common_action_id IS NOT NULL AND common_action_version_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_webinar_actions_common_action
  ON webinar_actions(common_action_id, common_action_version_id);

CREATE TABLE IF NOT EXISTS webinar_action_executions (
  id                  TEXT PRIMARY KEY,
  webinar_id          TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  trigger_type        TEXT NOT NULL CHECK (trigger_type IN (
                        'completed', 'cta_click', 'missed'
                      )),
  friend_id           TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  session_start_at    INTEGER NOT NULL,
  automation_run_id   TEXT NOT NULL REFERENCES automation_runs(id),
  source_event_id     TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  UNIQUE (webinar_id, trigger_type, friend_id, session_start_at),
  UNIQUE (automation_run_id)
);

CREATE INDEX IF NOT EXISTS idx_webinar_action_executions_webinar
  ON webinar_action_executions(webinar_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_webinar_action_executions_no_delete
BEFORE DELETE ON webinar_action_executions
BEGIN SELECT RAISE(ABORT, 'webinar action execution history cannot be deleted'); END;
