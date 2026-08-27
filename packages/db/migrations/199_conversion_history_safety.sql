-- 成果地点は過去実績の根拠なので、削除せず計測停止として残す。
ALTER TABLE conversion_points ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'stopped'));
ALTER TABLE conversion_points ADD COLUMN stopped_at TEXT;
ALTER TABLE conversion_points ADD COLUMN updated_at TEXT;

UPDATE conversion_points SET updated_at = created_at WHERE updated_at IS NULL;

-- 成果が起きた時点の定義と金額を固定する。旧データは現在の地点から補完する。
ALTER TABLE conversion_events ADD COLUMN point_name_snapshot TEXT;
ALTER TABLE conversion_events ADD COLUMN event_type_snapshot TEXT;
ALTER TABLE conversion_events ADD COLUMN value_snapshot REAL;
ALTER TABLE conversion_events ADD COLUMN idempotency_key TEXT;

UPDATE conversion_events
   SET point_name_snapshot = (
         SELECT cp.name FROM conversion_points cp WHERE cp.id = conversion_point_id
       ),
       event_type_snapshot = (
         SELECT cp.event_type FROM conversion_points cp WHERE cp.id = conversion_point_id
       ),
       value_snapshot = (
         SELECT cp.value FROM conversion_points cp WHERE cp.id = conversion_point_id
       )
 WHERE point_name_snapshot IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversion_events_idempotency
  ON conversion_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversion_points_status
  ON conversion_points(status, created_at DESC);

CREATE TRIGGER IF NOT EXISTS conversion_points_prevent_delete
BEFORE DELETE ON conversion_points
BEGIN SELECT RAISE(ABORT, 'conversion_points must be stopped, not deleted'); END;
