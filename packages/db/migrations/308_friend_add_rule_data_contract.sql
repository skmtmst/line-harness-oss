-- V6 機能9: 友だち追加時配信のフォルダ、版競合、停止の再送保証。

ALTER TABLE friend_add_rules ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1
  CHECK (lock_version > 0);
ALTER TABLE friend_add_rules ADD COLUMN stop_idempotency_key TEXT;
ALTER TABLE friend_add_rules ADD COLUMN stopped_at TEXT;
ALTER TABLE friend_add_rules ADD COLUMN stopped_by_staff_id TEXT;
ALTER TABLE friend_add_events ADD COLUMN scenario_enrollment_id TEXT REFERENCES friend_scenarios(id) ON DELETE SET NULL;
ALTER TABLE friend_add_events ADD COLUMN delivery_count INTEGER NOT NULL DEFAULT 0
  CHECK (delivery_count >= 0);
ALTER TABLE friend_add_events ADD COLUMN first_delivery_sent_at TEXT;

-- 流入リンクは従来 tenant 単位しか持てなかった。機能9から選ぶリンクを
-- LINE公式アカウント単位で検査できるよう、所有アカウントを任意で固定する。
-- 既存の NULL 行は tenant 内の互換データとして読み、新規・更新時に順次固定する。
ALTER TABLE entry_routes ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_entry_routes_line_account_active
  ON entry_routes(line_account_id, is_active, name, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_add_rules_stop_idempotency
  ON friend_add_rules(line_account_id, stop_idempotency_key)
  WHERE stop_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS friend_add_rule_folders (
  id                      TEXT PRIMARY KEY,
  line_account_id         TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  create_idempotency_key  TEXT NOT NULL,
  created_by_staff_id     TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  UNIQUE (line_account_id, name),
  UNIQUE (line_account_id, create_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_friend_add_rule_folders_account_name
  ON friend_add_rule_folders(line_account_id, name, id);

CREATE INDEX IF NOT EXISTS idx_friend_add_events_rule_time
  ON friend_add_events(line_account_id, routing_rule_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_friend_add_action_runs_event_status
  ON friend_add_action_runs(event_id, status, created_at, id);
