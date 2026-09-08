-- migration-policy: table-rebuild
-- N-101(#622): 送れなかった実行を completed にせず partial_failed で残せるよう、
-- friend_add_events.routing_status の検査に 'partial_failed' を足す。
-- 列・行の中身は変えない。completed は「送った」印のままにし、
-- 再送制限が数えるのは completed だけにする。送れなかった人が再送制限に
-- 数えられて永久に送れなくなるのを防ぐ。
-- 子表 friend_add_action_runs も一緒に付け替える。付け替えずに親を落とすと、
-- foreign_keys=ON の環境で DROP が止まる。

CREATE TABLE friend_add_events_new (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id             TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  webhook_event_id      TEXT NOT NULL,
  friend_kind           TEXT NOT NULL CHECK (friend_kind IN ('first_time', 'returning')),
  is_unblocked_hint     INTEGER CHECK (is_unblocked_hint IS NULL OR is_unblocked_hint IN (0, 1)),
  attribution_status    TEXT NOT NULL DEFAULT 'unavailable'
                          CHECK (attribution_status IN ('captured', 'unavailable')),
  ref_code              TEXT,
  entry_route_id        TEXT REFERENCES entry_routes(id) ON DELETE SET NULL,
  candidate_id          TEXT REFERENCES friend_add_attribution_candidates(id) ON DELETE SET NULL,
  routing_rule_id       TEXT,
  routing_status        TEXT NOT NULL DEFAULT 'pending'
                          CHECK (routing_status IN ('pending', 'completed', 'failed', 'suppressed', 'partial_failed')),
  occurred_at           TEXT NOT NULL,
  processed_at          TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  winning_rule_version_id TEXT,
  error_code            TEXT,
  scenario_enrollment_id TEXT REFERENCES friend_scenarios(id) ON DELETE SET NULL,
  delivery_count        INTEGER NOT NULL DEFAULT 0
                          CHECK (delivery_count >= 0),
  first_delivery_sent_at TEXT,
  UNIQUE (line_account_id, webhook_event_id)
);

INSERT INTO friend_add_events_new (
  id, line_account_id, friend_id, webhook_event_id, friend_kind,
  is_unblocked_hint, attribution_status, ref_code, entry_route_id,
  candidate_id, routing_rule_id, routing_status, occurred_at, processed_at,
  created_at, winning_rule_version_id, error_code, scenario_enrollment_id,
  delivery_count, first_delivery_sent_at
)
SELECT
  id, line_account_id, friend_id, webhook_event_id, friend_kind,
  is_unblocked_hint, attribution_status, ref_code, entry_route_id,
  candidate_id, routing_rule_id, routing_status, occurred_at, processed_at,
  created_at, winning_rule_version_id, error_code, scenario_enrollment_id,
  delivery_count, first_delivery_sent_at
FROM friend_add_events;

CREATE TABLE friend_add_action_runs_new (
  id                  TEXT PRIMARY KEY,
  event_id            TEXT NOT NULL REFERENCES friend_add_events_new(id) ON DELETE CASCADE,
  action_stable_id    TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempt_count       INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_retry_at       TEXT,
  last_error_code     TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (event_id, action_stable_id)
);

INSERT INTO friend_add_action_runs_new (
  id, event_id, action_stable_id, idempotency_key, status, attempt_count,
  next_retry_at, last_error_code, created_at, updated_at
)
SELECT
  id, event_id, action_stable_id, idempotency_key, status, attempt_count,
  next_retry_at, last_error_code, created_at, updated_at
FROM friend_add_action_runs;

DROP TABLE friend_add_action_runs;
DROP TABLE friend_add_events;

ALTER TABLE friend_add_events_new RENAME TO friend_add_events;
ALTER TABLE friend_add_action_runs_new RENAME TO friend_add_action_runs;

-- 表の再構築前と同じ索引名だと適用判定で飛ばされるため、357 固有名で貼り直す。
CREATE INDEX idx_friend_add_events_v357_account_time
  ON friend_add_events(line_account_id, occurred_at DESC, id DESC);

CREATE INDEX idx_friend_add_events_v357_account_state
  ON friend_add_events(line_account_id, friend_kind, attribution_status, routing_status);

CREATE INDEX idx_friend_add_events_v357_friend
  ON friend_add_events(line_account_id, friend_id, occurred_at DESC);

CREATE INDEX idx_friend_add_events_v357_rule_time
  ON friend_add_events(line_account_id, routing_rule_id, occurred_at DESC, id DESC);

CREATE INDEX idx_friend_add_action_runs_v357_retry
  ON friend_add_action_runs(status, next_retry_at);

CREATE INDEX idx_friend_add_action_runs_v357_event_status
  ON friend_add_action_runs(event_id, status, created_at, id);
