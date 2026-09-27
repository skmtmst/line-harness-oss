-- 459: 一斉配信の操作の記録（#816）。
-- 付け足すだけ（CREATE TABLE・CREATE INDEX）。
--
-- 作成・編集・予約・送信の開始・停止・再開・再送・予約の取消を残す。
-- 承認の依頼・承認・差し戻し・期限切れは broadcast_approval_events（455）に
-- あるので、ここには書かず、記録の一覧で合わせて読む。
--
-- 記録は消さない。取り消しは逆向きの記録を足す。UPDATE・DELETE はしない。
CREATE TABLE IF NOT EXISTS broadcast_lifecycle_events (
  id              TEXT PRIMARY KEY,
  broadcast_id    TEXT NOT NULL REFERENCES broadcasts (id) ON DELETE CASCADE,
  actor_staff_id  TEXT,
  action          TEXT NOT NULL CHECK (action IN (
    'created', 'updated', 'scheduled', 'send_started',
    'stopped', 'resumed', 'retried', 'cancelled'
  )),
  reason          TEXT,
  detail_json     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_broadcast_lifecycle_events_broadcast
  ON broadcast_lifecycle_events (broadcast_id, created_at DESC);
