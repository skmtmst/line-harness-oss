-- 機能19: 成果地点の作成条件、保存前試算、停止・差し替え・安全な削除。

ALTER TABLE conversion_points ADD COLUMN source_config_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(source_config_json));
ALTER TABLE conversion_points ADD COLUMN deduplication_mode TEXT NOT NULL DEFAULT 'every'
  CHECK (deduplication_mode IN ('every', 'once_per_friend', 'window'));
ALTER TABLE conversion_points ADD COLUMN deduplication_window_days INTEGER
  CHECK (deduplication_window_days IS NULL OR deduplication_window_days BETWEEN 1 AND 365);
ALTER TABLE conversion_points ADD COLUMN value_mode TEXT NOT NULL DEFAULT 'fixed'
  CHECK (value_mode IN ('source', 'fixed', 'none'));
ALTER TABLE conversion_points ADD COLUMN reversal_policy TEXT NOT NULL DEFAULT 'manual'
  CHECK (reversal_policy IN ('source_cancelled', 'manual', 'none'));

CREATE TABLE IF NOT EXISTS conversion_definition_operations (
  id                  TEXT PRIMARY KEY,
  conversion_point_id TEXT NOT NULL,
  action              TEXT NOT NULL CHECK (action IN ('stop', 'replace', 'delete')),
  replacement_id      TEXT,
  affected_usages     INTEGER NOT NULL DEFAULT 0 CHECK (affected_usages >= 0),
  reason              TEXT,
  performed_by        TEXT NOT NULL,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversion_definition_operations_point
  ON conversion_definition_operations(conversion_point_id, created_at DESC);

-- 271では全面的に物理削除を止めた。未使用・成果0件だけはV6契約で削除できる。
-- 実行時はDELETE文そのものが成果・利用先の不存在を再確認する。
DROP TRIGGER IF EXISTS conversion_points_prevent_delete;

CREATE TRIGGER conversion_points_prevent_delete
BEFORE DELETE ON conversion_points
WHEN EXISTS (
  SELECT 1 FROM conversion_events WHERE conversion_point_id = OLD.id
) OR EXISTS (
  SELECT 1 FROM conversion_definition_usages WHERE conversion_point_id = OLD.id
)
BEGIN SELECT RAISE(ABORT, 'conversion point with events or usages cannot be deleted'); END;
