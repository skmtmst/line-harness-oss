-- 455: 一斉配信の二者承認の履歴（誰がいつ何をしたか）。
-- 付け足すだけ（CREATE TABLE・CREATE INDEX）。監査の記録なので更新・削除しない。
CREATE TABLE IF NOT EXISTS broadcast_approval_events (
  id              TEXT PRIMARY KEY,
  broadcast_id    TEXT NOT NULL REFERENCES broadcasts (id) ON DELETE CASCADE,
  actor_staff_id  TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('requested', 'approved', 'rejected', 'cancelled', 'expired', 'reminded')),
  reason          TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_broadcast_approval_events_broadcast
  ON broadcast_approval_events (broadcast_id, created_at DESC);
