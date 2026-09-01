-- V6 3-3-A 統合ユーザー詳細。
-- 元のfriendsを残し、採用したプロフィール値・配信優先順位・変更履歴を
-- usersの版と一緒に管理する。
--
-- 既存usersのtenant_idは一律に埋めない。既存行の所属は関連するfriendsの
-- LINEアカウントから検査し、新しく作る統合ユーザーだけ明示的に記録する。
ALTER TABLE users ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'review', 'archived'));
ALTER TABLE users ADD COLUMN primary_display_name TEXT;
ALTER TABLE users ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);
ALTER TABLE users ADD COLUMN created_by TEXT;
ALTER TABLE users ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_tenant_status
  ON users(tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_profile_values (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  value_preview TEXT,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('friend', 'friend_field', 'form', 'ec', 'manual')),
  source_id TEXT,
  source_label TEXT NOT NULL,
  source_friend_id TEXT REFERENCES friends(id) ON DELETE RESTRICT,
  verified_at TEXT,
  selected_by TEXT,
  selected_by_name TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  update_mode TEXT NOT NULL CHECK (update_mode IN ('auto', 'fixed')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profile_values_active_field
  ON user_profile_values(tenant_id, user_id, field_key) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_user_profile_values_history
  ON user_profile_values(tenant_id, user_id, field_key, selected_at DESC);

CREATE TABLE IF NOT EXISTS user_delivery_priorities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL
    CHECK (purpose IN ('broadcast', 'scenario', 'reminder', 'transactional', 'manual')),
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE RESTRICT,
  priority INTEGER NOT NULL CHECK (priority >= 1),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  reason TEXT NOT NULL,
  selected_by TEXT,
  selected_at TEXT NOT NULL,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_delivery_priorities_active_friend
  ON user_delivery_priorities(tenant_id, user_id, purpose, friend_id)
  WHERE retired_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_delivery_priorities_active_order
  ON user_delivery_priorities(tenant_id, user_id, purpose, priority)
  WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_delivery_priorities_lookup
  ON user_delivery_priorities(tenant_id, user_id, purpose, priority);

-- profile/priorityの変更も、#598の候補判定と同じく追記専用で残す。
-- APIはbefore/afterをそのまま返さず、安全なsummaryだけを返す。
CREATE TABLE IF NOT EXISTS identity_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  candidate_id TEXT REFERENCES identity_candidates(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('candidate', 'link', 'unlink', 'profile', 'priority', 'migration')),
  summary TEXT NOT NULL,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  actor_staff_id TEXT,
  actor_name TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  correlation_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_identity_events_user_history
  ON identity_events(tenant_id, user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_events_candidate_history
  ON identity_events(tenant_id, candidate_id, occurred_at DESC);
