-- V6 7-1-C〜G: 公開済みリマインダを後編集から守り、登録時の版を固定する。
--
-- reminder_steps は既存配信との互換用に残す。新しい編集は draft snapshot に書き、
-- publish のときだけ互換表へ反映する。既存登録は reminder_version_id を見て、
-- 公開後も登録時の内容で配信する。

ALTER TABLE reminders ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'published'
  CHECK (lifecycle_status IN ('draft', 'published', 'stopped'));
ALTER TABLE reminders ADD COLUMN current_draft_version_id TEXT;
ALTER TABLE reminders ADD COLUMN current_published_version_id TEXT;

CREATE TABLE IF NOT EXISTS reminder_versions (
  id                    TEXT PRIMARY KEY,
  reminder_id           TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  version_number        INTEGER NOT NULL CHECK (version_number > 0),
  status                TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'superseded')),
  settings_snapshot     TEXT NOT NULL CHECK (json_valid(settings_snapshot)),
  last_test_status      TEXT CHECK (last_test_status IN ('succeeded', 'failed')),
  last_tested_at        TEXT,
  last_tested_by_staff_id TEXT,
  published_at          TEXT,
  published_by_staff_id TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (reminder_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_reminder_versions_status
  ON reminder_versions (reminder_id, status, version_number DESC);

CREATE TABLE IF NOT EXISTS reminder_version_steps (
  id                    TEXT PRIMARY KEY,
  reminder_version_id   TEXT NOT NULL REFERENCES reminder_versions(id) ON DELETE CASCADE,
  stable_step_id        TEXT NOT NULL,
  position              INTEGER NOT NULL DEFAULT 0,
  offset_minutes        INTEGER NOT NULL,
  message_type          TEXT NOT NULL,
  message_content       TEXT NOT NULL,
  offset_days           INTEGER,
  send_at_time          TEXT,
  template_id           TEXT,
  target_condition_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(target_condition_json)),
  action_json           TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(action_json)),
  created_at            TEXT NOT NULL,
  UNIQUE (reminder_version_id, stable_step_id)
);

CREATE INDEX IF NOT EXISTS idx_reminder_version_steps_order
  ON reminder_version_steps (reminder_version_id, position, stable_step_id);

ALTER TABLE friend_reminders ADD COLUMN reminder_version_id TEXT REFERENCES reminder_versions(id);
ALTER TABLE friend_reminders ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE friend_reminders ADD COLUMN source_id TEXT;
ALTER TABLE friend_reminders ADD COLUMN source_event_id TEXT;
ALTER TABLE friend_reminders ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo';
ALTER TABLE friend_reminders ADD COLUMN cancel_reason TEXT;
ALTER TABLE friend_reminders ADD COLUMN completed_at TEXT;
ALTER TABLE friend_reminders ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_reminders_source_event
  ON friend_reminders (reminder_id, friend_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

-- 現行定義を公開版1として固定する。IDは既存 reminder id から決定的に作り、
-- 再現可能な移行にする。
INSERT INTO reminder_versions (
  id, reminder_id, version_number, status, settings_snapshot,
  published_at, created_at, updated_at
)
SELECT
  'reminder-version-v1-' || r.id,
  r.id,
  1,
  'published',
  json_object(
    'name', r.name,
    'description', r.description,
    'lineAccountId', r.line_account_id,
    'triggerType', r.trigger_type,
    'deliveryMode', r.delivery_mode,
    'triggerFieldId', r.trigger_field_id,
    'repeatYearly', CASE WHEN r.repeat_yearly = 1 THEN json('true') ELSE json('false') END,
    'triggerOffsetMinutes', r.trigger_offset_minutes,
    'sendAtTime', r.send_at_time,
    'targetTagId', r.target_tag_id,
    'folderId', r.folder_id,
    'stopConditions', json_object(
      'bookingCancelled', json('true'),
      'supportMarkCompleted', json('false'),
      'daysAfterTarget', 7,
      'friendBlocked', json('true')
    )
  ),
  r.updated_at,
  r.created_at,
  r.updated_at
FROM reminders r;

INSERT INTO reminder_version_steps (
  id, reminder_version_id, stable_step_id, position,
  offset_minutes, message_type, message_content, offset_days,
  send_at_time, template_id, created_at
)
SELECT
  'reminder-version-step-v1-' || s.id,
  'reminder-version-v1-' || s.reminder_id,
  s.id,
  ROW_NUMBER() OVER (PARTITION BY s.reminder_id ORDER BY s.offset_minutes, s.created_at, s.id) - 1,
  s.offset_minutes,
  s.message_type,
  s.message_content,
  s.offset_days,
  s.send_at_time,
  s.template_id,
  s.created_at
FROM reminder_steps s;

UPDATE reminders
SET current_published_version_id = 'reminder-version-v1-' || id,
    lifecycle_status = CASE WHEN is_active = 1 THEN 'published' ELSE 'stopped' END;

UPDATE friend_reminders
SET reminder_version_id = 'reminder-version-v1-' || reminder_id
WHERE reminder_version_id IS NULL;

-- 公開済みの内容は、その版を使っている登録があるため書き換えない。
-- 公開中から旧版へ進める status 更新と監査時刻だけは許可する。
CREATE TRIGGER IF NOT EXISTS trg_reminder_versions_immutable_update
BEFORE UPDATE OF reminder_id, version_number, settings_snapshot ON reminder_versions
WHEN OLD.status IN ('published', 'superseded')
BEGIN SELECT RAISE(ABORT, 'published reminder versions are immutable'); END;

-- 公開済みから下書きへ戻す操作は許可しない。公開版を差し替えるときだけ、
-- 旧版を superseded へ進められる。
CREATE TRIGGER IF NOT EXISTS trg_reminder_versions_status_transition
BEFORE UPDATE OF status ON reminder_versions
WHEN OLD.status IN ('published', 'superseded')
 AND NEW.status <> OLD.status
 AND NOT (OLD.status = 'published' AND NEW.status = 'superseded')
BEGIN SELECT RAISE(ABORT, 'published reminder version status cannot move backwards'); END;

CREATE TRIGGER IF NOT EXISTS trg_reminder_versions_immutable_delete
BEFORE DELETE ON reminder_versions
WHEN OLD.status IN ('published', 'superseded')
BEGIN SELECT RAISE(ABORT, 'published reminder versions cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS trg_reminder_version_steps_immutable_insert
BEFORE INSERT ON reminder_version_steps
WHEN COALESCE((
  SELECT status FROM reminder_versions WHERE id = NEW.reminder_version_id
), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'published reminder version steps are immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_reminder_version_steps_immutable_update
BEFORE UPDATE ON reminder_version_steps
WHEN COALESCE((
  SELECT status FROM reminder_versions WHERE id = OLD.reminder_version_id
), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'published reminder version steps are immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_reminder_version_steps_immutable_delete
BEFORE DELETE ON reminder_version_steps
WHEN COALESCE((
  SELECT status FROM reminder_versions WHERE id = OLD.reminder_version_id
), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'published reminder version steps are immutable'); END;
