-- V6 9: 友だち追加時配信を、アカウントに1件の設定から
-- 複数ルール・固定した公開版・アクション実行履歴へ広げる。

CREATE TABLE friend_add_rules (
  id                         TEXT PRIMARY KEY,
  line_account_id            TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_kind                TEXT NOT NULL CHECK (friend_kind IN ('first_time', 'returning')),
  name                       TEXT NOT NULL,
  folder_name                TEXT,
  priority                   INTEGER NOT NULL CHECK (priority > 0),
  is_unknown_route_fallback  INTEGER NOT NULL DEFAULT 0
                               CHECK (is_unknown_route_fallback IN (0, 1)),
  status                     TEXT NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'published', 'stopped', 'archived')),
  current_version_id         TEXT,
  create_idempotency_key     TEXT,
  archived_at                TEXT,
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE UNIQUE INDEX idx_friend_add_rules_unknown_fallback
  ON friend_add_rules (line_account_id, friend_kind)
  WHERE is_unknown_route_fallback = 1 AND archived_at IS NULL;

CREATE INDEX idx_friend_add_rules_account_kind_priority
  ON friend_add_rules (line_account_id, friend_kind, priority, created_at);

CREATE UNIQUE INDEX idx_friend_add_rules_create_idempotency
  ON friend_add_rules (line_account_id, create_idempotency_key)
  WHERE create_idempotency_key IS NOT NULL;

CREATE TABLE friend_add_rule_versions (
  id                       TEXT PRIMARY KEY,
  rule_id                  TEXT NOT NULL REFERENCES friend_add_rules(id) ON DELETE CASCADE,
  version_number           INTEGER NOT NULL,
  definition_snapshot      TEXT NOT NULL CHECK (json_valid(definition_snapshot)),
  status                   TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  last_test_status         TEXT CHECK (last_test_status IN ('succeeded', 'failed')),
  last_tested_at           TEXT,
  last_tested_by_staff_id  TEXT,
  draft_save_idempotency_key TEXT,
  published_at             TEXT,
  published_by_staff_id    TEXT,
  publish_idempotency_key  TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (rule_id, version_number),
  UNIQUE (rule_id, draft_save_idempotency_key),
  UNIQUE (rule_id, publish_idempotency_key)
);

CREATE UNIQUE INDEX idx_friend_add_rule_versions_one_draft
  ON friend_add_rule_versions (rule_id)
  WHERE status = 'draft';

CREATE UNIQUE INDEX idx_friend_add_rule_versions_one_published
  ON friend_add_rule_versions (rule_id)
  WHERE status = 'published';

CREATE TABLE friend_add_action_runs (
  id                  TEXT PRIMARY KEY,
  event_id            TEXT NOT NULL REFERENCES friend_add_events(id) ON DELETE CASCADE,
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

CREATE INDEX idx_friend_add_action_runs_retry
  ON friend_add_action_runs (status, next_retry_at);

ALTER TABLE friend_add_events ADD COLUMN winning_rule_version_id TEXT;
ALTER TABLE friend_add_events ADD COLUMN error_code TEXT;

-- 現行のアカウント設定は、初回用・再追加用の削除できない受け皿へ変換する。
-- 流入元を推測せず、経路不明のルールとしてだけ引き継ぐ。
INSERT INTO friend_add_rules (
  id, line_account_id, friend_kind, name, priority,
  is_unknown_route_fallback, status, created_at, updated_at
)
SELECT
  'friend-add-rule-first-' || line_account_id,
  line_account_id,
  'first_time',
  '経路が分からなかった人',
  9999,
  1,
  'published',
  created_at,
  updated_at
FROM account_settings
WHERE key = 'friend_add_routing' AND json_valid(value);

INSERT INTO friend_add_rules (
  id, line_account_id, friend_kind, name, priority,
  is_unknown_route_fallback, status, created_at, updated_at
)
SELECT
  'friend-add-rule-returning-' || line_account_id,
  line_account_id,
  'returning',
  '経路が分からなかった人',
  9999,
  1,
  'published',
  created_at,
  updated_at
FROM account_settings
WHERE key = 'friend_add_routing' AND json_valid(value);

-- 設定がまだ無いアカウントにも、旧「有効なものを全部流す」へ戻らない
-- 明示的な受け皿を作る。シナリオを選ぶまでは安全側で配信を抑止する。
INSERT INTO friend_add_rules (
  id, line_account_id, friend_kind, name, priority,
  is_unknown_route_fallback, status
)
SELECT
  'friend-add-rule-first-' || a.id,
  a.id,
  'first_time',
  '経路が分からなかった人',
  9999,
  1,
  'published'
FROM line_accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM friend_add_rules r
   WHERE r.line_account_id = a.id AND r.friend_kind = 'first_time'
     AND r.is_unknown_route_fallback = 1 AND r.archived_at IS NULL
);

INSERT INTO friend_add_rules (
  id, line_account_id, friend_kind, name, priority,
  is_unknown_route_fallback, status
)
SELECT
  'friend-add-rule-returning-' || a.id,
  a.id,
  'returning',
  '経路が分からなかった人',
  9999,
  1,
  'published'
FROM line_accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM friend_add_rules r
   WHERE r.line_account_id = a.id AND r.friend_kind = 'returning'
     AND r.is_unknown_route_fallback = 1 AND r.archived_at IS NULL
);

INSERT INTO friend_add_rule_versions (
  id, rule_id, version_number, definition_snapshot, status,
  published_at, created_at, updated_at
)
SELECT
  'friend-add-rule-version-first-' || line_account_id,
  'friend-add-rule-first-' || line_account_id,
  1,
  json_object(
    'routeIds', json('[]'),
    'scenarioId', json_extract(value, '$.firstTime.scenarioId'),
    'messageType', 'scenario',
    'messageText', '',
    'timing', COALESCE(json_extract(value, '$.firstTime.timing'), 'immediate'),
    'actions', COALESCE(json_extract(value, '$.firstTime.actions'), json('[]')),
    'friendCondition', '',
    'activeFrom', NULL,
    'activeUntil', NULL
  ),
  'published',
  updated_at,
  created_at,
  updated_at
FROM account_settings
WHERE key = 'friend_add_routing' AND json_valid(value);

INSERT INTO friend_add_rule_versions (
  id, rule_id, version_number, definition_snapshot, status,
  published_at, created_at, updated_at
)
SELECT
  'friend-add-rule-version-returning-' || line_account_id,
  'friend-add-rule-returning-' || line_account_id,
  1,
  json_object(
    'routeIds', json('[]'),
    'scenarioId', CASE json_extract(value, '$.returning.mode')
      WHEN 'same' THEN json_extract(value, '$.firstTime.scenarioId')
      ELSE json_extract(value, '$.returning.scenarioId')
    END,
    'messageType', 'scenario',
    'messageText', '',
    'timing', CASE json_extract(value, '$.returning.mode')
      WHEN 'same' THEN COALESCE(json_extract(value, '$.firstTime.timing'), 'immediate')
      ELSE 'scenario'
    END,
    'actions', CASE json_extract(value, '$.returning.mode')
      WHEN 'same' THEN COALESCE(json_extract(value, '$.firstTime.actions'), json('[]'))
      ELSE COALESCE(json_extract(value, '$.returning.actions'), json('[]'))
    END,
    'friendCondition', '',
    'activeFrom', NULL,
    'activeUntil', NULL,
    'returningMode', COALESCE(json_extract(value, '$.returning.mode'), 'same'),
    'startPosition', COALESCE(json_extract(value, '$.returning.startPosition'), 'beginning')
  ),
  'published',
  updated_at,
  created_at,
  updated_at
FROM account_settings
WHERE key = 'friend_add_routing' AND json_valid(value);

UPDATE friend_add_rules
SET current_version_id = CASE friend_kind
  WHEN 'first_time' THEN 'friend-add-rule-version-first-' || line_account_id
  ELSE 'friend-add-rule-version-returning-' || line_account_id
END
WHERE EXISTS (
  SELECT 1 FROM friend_add_rule_versions v
   WHERE v.id = CASE friend_add_rules.friend_kind
     WHEN 'first_time' THEN 'friend-add-rule-version-first-' || friend_add_rules.line_account_id
     ELSE 'friend-add-rule-version-returning-' || friend_add_rules.line_account_id
   END
);

INSERT INTO friend_add_rule_versions (
  id, rule_id, version_number, definition_snapshot, status, published_at
)
SELECT
  'friend-add-rule-version-' || r.friend_kind || '-' || r.line_account_id,
  r.id,
  1,
  json_object(
    'routeIds', json('[]'),
    'scenarioId', NULL,
    'messageType', 'scenario',
    'messageText', '',
    'timing', 'scenario',
    'actions', json('[]'),
    'friendCondition', '',
    'activeFrom', NULL,
    'activeUntil', NULL,
    'returningMode', CASE r.friend_kind WHEN 'returning' THEN 'none' ELSE NULL END,
    'startPosition', CASE r.friend_kind WHEN 'returning' THEN 'beginning' ELSE NULL END
  ),
  'published',
  r.updated_at
FROM friend_add_rules r
WHERE r.is_unknown_route_fallback = 1 AND r.current_version_id IS NULL;

UPDATE friend_add_rules
SET current_version_id = 'friend-add-rule-version-' || friend_kind || '-' || line_account_id
WHERE is_unknown_route_fallback = 1 AND current_version_id IS NULL;

CREATE TRIGGER trg_friend_add_rule_versions_immutable_update
BEFORE UPDATE OF rule_id, version_number, definition_snapshot
ON friend_add_rule_versions
WHEN OLD.status IN ('published', 'retired')
BEGIN SELECT RAISE(ABORT, 'published friend-add rule versions are immutable'); END;

CREATE TRIGGER trg_friend_add_rule_versions_immutable_delete
BEFORE DELETE ON friend_add_rule_versions
WHEN OLD.status IN ('published', 'retired')
BEGIN SELECT RAISE(ABORT, 'published friend-add rule versions cannot be deleted'); END;
