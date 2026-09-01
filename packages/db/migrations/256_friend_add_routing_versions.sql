-- V6 9-1-F/G: 友だち追加時配信を、本番設定へ直接上書きせず
-- 下書き・試験・固定した公開版に分ける。

CREATE TABLE friend_add_routing_versions (
  id                         TEXT PRIMARY KEY,
  line_account_id            TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  version_number             INTEGER NOT NULL,
  definition_snapshot        TEXT NOT NULL CHECK (json_valid(definition_snapshot)),
  status                     TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  last_test_status           TEXT CHECK (last_test_status IN ('succeeded', 'failed')),
  last_tested_at             TEXT,
  last_tested_by_staff_id    TEXT,
  published_at               TEXT,
  published_by_staff_id      TEXT,
  publish_idempotency_key    TEXT,
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, version_number),
  UNIQUE (line_account_id, publish_idempotency_key)
);

CREATE UNIQUE INDEX idx_friend_add_routing_one_draft
  ON friend_add_routing_versions (line_account_id)
  WHERE status = 'draft';

CREATE UNIQUE INDEX idx_friend_add_routing_one_published
  ON friend_add_routing_versions (line_account_id)
  WHERE status = 'published';

CREATE INDEX idx_friend_add_routing_versions_status
  ON friend_add_routing_versions (line_account_id, status, version_number DESC);

-- 現在動いている設定を公開版1として固定する。設定がまだ無いアカウントは、
-- 初めて下書きを保存した時点で版を作る。
INSERT INTO friend_add_routing_versions (
  id, line_account_id, version_number, definition_snapshot, status,
  published_at, created_at, updated_at
)
SELECT
  'friend-add-routing-v1-' || line_account_id,
  line_account_id,
  1,
  value,
  'published',
  updated_at,
  created_at,
  updated_at
FROM account_settings
WHERE key = 'friend_add_routing'
  AND json_valid(value);

-- 公開済みの定義は、あとから本文を書き換えない。公開中から retired への
-- 遷移だけを許し、過去に実際に動いた版を監査できるようにする。
CREATE TRIGGER trg_friend_add_routing_versions_immutable_update
BEFORE UPDATE OF line_account_id, version_number, definition_snapshot
ON friend_add_routing_versions
WHEN OLD.status IN ('published', 'retired')
BEGIN SELECT RAISE(ABORT, 'published friend-add routing versions are immutable'); END;

CREATE TRIGGER trg_friend_add_routing_versions_status_transition
BEFORE UPDATE OF status ON friend_add_routing_versions
WHEN OLD.status IN ('published', 'retired')
 AND NEW.status <> OLD.status
 AND NOT (OLD.status = 'published' AND NEW.status = 'retired')
BEGIN SELECT RAISE(ABORT, 'published friend-add routing version status cannot move backwards'); END;

CREATE TRIGGER trg_friend_add_routing_versions_immutable_delete
BEFORE DELETE ON friend_add_routing_versions
WHEN OLD.status IN ('published', 'retired')
BEGIN SELECT RAISE(ABORT, 'published friend-add routing versions cannot be deleted'); END;
