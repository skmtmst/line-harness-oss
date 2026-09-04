-- V6 8-1-D〜G: 自動応答を本番へ直接上書きせず、下書き・試験・公開版に分ける。
--
-- auto_replies は実行中の正本として残す。編集内容は auto_reply_versions の
-- draft に保存し、公開時だけ1回のD1 batchで正本へ反映する。

ALTER TABLE auto_replies ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'published'
  CHECK (lifecycle_status IN ('draft', 'published', 'stopped'));
ALTER TABLE auto_replies ADD COLUMN current_draft_version_id TEXT;
ALTER TABLE auto_replies ADD COLUMN current_published_version_id TEXT;

ALTER TABLE auto_reply_versions ADD COLUMN last_test_status TEXT
  CHECK (last_test_status IN ('succeeded', 'failed'));
ALTER TABLE auto_reply_versions ADD COLUMN last_tested_at TEXT;
ALTER TABLE auto_reply_versions ADD COLUMN last_tested_by_staff_id TEXT;
ALTER TABLE auto_reply_versions ADD COLUMN publish_idempotency_key TEXT;
ALTER TABLE auto_reply_versions ADD COLUMN updated_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_reply_versions_publish_key
  ON auto_reply_versions (publish_idempotency_key)
  WHERE publish_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auto_reply_versions_status
  ON auto_reply_versions (auto_reply_id, status, version_number DESC);

-- まだ受信イベントに当たっておらず版が作られていない既存ルールも、現行値を
-- 公開版1として固定する。既に270で版があるルールはその版をそのまま使う。
INSERT OR IGNORE INTO auto_reply_versions (
  id, auto_reply_id, version_number, line_account_id, definition_snapshot,
  status, published_at, created_at, updated_at
)
SELECT
  'auto-reply-version-v1-' || ar.id,
  ar.id,
  1,
  ar.line_account_id,
  json_object(
    'keyword', ar.keyword,
    'matchType', ar.match_type,
    'responseType', ar.response_type,
    'responseContent', ar.response_content,
    'templateId', ar.template_id,
    'lineAccountId', ar.line_account_id,
    'activeFrom', ar.active_from,
    'activeUntil', ar.active_until,
    'cooldownMinutes', ar.cooldown_minutes,
    'skipWhenOperatorActive', CASE WHEN ar.skip_when_operator_active = 1 THEN json('true') ELSE json('false') END,
    'priority', ar.priority,
    'messageKinds', ar.message_kinds_json,
    'friendConditions', ar.friend_conditions_json,
    'actions', ar.actions_json,
    'responseWeekdays', ar.response_weekdays_json,
    'responseHolidayRule', ar.response_holiday_rule,
    'oncePerFriend', CASE WHEN ar.once_per_friend = 1 THEN json('true') ELSE json('false') END,
    'keywords', ar.keywords_json,
    'respondToAll', CASE WHEN ar.respond_to_all = 1 THEN json('true') ELSE json('false') END,
    'name', ar.name,
    'keywordMatchMode', ar.keyword_match_mode,
    'folderId', ar.folder_id
  ),
  'published',
  ar.created_at,
  ar.created_at,
  ar.created_at
FROM auto_replies ar
WHERE NOT EXISTS (
  SELECT 1 FROM auto_reply_versions arv WHERE arv.auto_reply_id = ar.id
);

UPDATE auto_reply_versions
SET updated_at = COALESCE(updated_at, published_at, created_at)
WHERE updated_at IS NULL;

UPDATE auto_replies
SET current_published_version_id = (
      SELECT arv.id
      FROM auto_reply_versions arv
      WHERE arv.auto_reply_id = auto_replies.id
        AND arv.status = 'published'
      ORDER BY arv.version_number DESC
      LIMIT 1
    ),
    lifecycle_status = CASE WHEN is_active = 1 THEN 'published' ELSE 'stopped' END;

-- 公開済みの定義は実行記録から参照されるため、本文を書き換えない。
CREATE TRIGGER IF NOT EXISTS trg_auto_reply_versions_immutable_update
BEFORE UPDATE OF auto_reply_id, version_number, line_account_id, definition_snapshot
ON auto_reply_versions
WHEN OLD.status IN ('published', 'retired')
BEGIN SELECT RAISE(ABORT, 'published auto reply versions are immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_auto_reply_versions_status_transition
BEFORE UPDATE OF status ON auto_reply_versions
WHEN OLD.status IN ('published', 'retired')
 AND NEW.status <> OLD.status
 AND NOT (OLD.status = 'published' AND NEW.status = 'retired')
BEGIN SELECT RAISE(ABORT, 'published auto reply version status cannot move backwards'); END;

CREATE TRIGGER IF NOT EXISTS trg_auto_reply_versions_immutable_delete
BEFORE DELETE ON auto_reply_versions
WHEN OLD.status IN ('published', 'retired')
BEGIN SELECT RAISE(ABORT, 'published auto reply versions cannot be deleted'); END;
