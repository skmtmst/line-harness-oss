-- 487: 高額マイル調整の承認履歴（誰がいつ何をしたか）。
-- 付け足すだけ（CREATE TABLE・CREATE INDEX）。監査の記録なので更新・削除しない。
CREATE TABLE IF NOT EXISTS mileage_adjustment_approval_events (
  id              TEXT PRIMARY KEY,
  request_id      TEXT NOT NULL REFERENCES mileage_adjustment_approval_requests (id) ON DELETE CASCADE,
  actor_staff_id  TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('requested', 'approved', 'rejected', 'cancelled')),
  reason          TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_mileage_adj_approval_events_request
  ON mileage_adjustment_approval_events (request_id, created_at DESC);
