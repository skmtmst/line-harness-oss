-- 一斉配信の送り手と訂正元。既存の配信行は変更せず、控えは配信の削除時に消す。
CREATE TABLE broadcast_sender_corrections (
  broadcast_id TEXT PRIMARY KEY REFERENCES broadcasts(id) ON DELETE CASCADE,
  sender_id TEXT REFERENCES line_senders(id) ON DELETE SET NULL,
  sender_snapshot_json TEXT CHECK (sender_snapshot_json IS NULL OR (
    json_valid(sender_snapshot_json) AND json_type(sender_snapshot_json) = 'object'
    AND json_type(sender_snapshot_json, '$.name') = 'text'
    AND json_remove(sender_snapshot_json, '$.name') = '{}'
  )),
  sent_by_staff_id TEXT,
  sent_by_staff_name TEXT,
  correction_of_broadcast_id TEXT REFERENCES broadcasts(id) ON DELETE RESTRICT,
  correction_request_key TEXT,
  CHECK (correction_of_broadcast_id IS NULL OR correction_of_broadcast_id <> broadcast_id),
  UNIQUE (correction_of_broadcast_id, correction_request_key)
);
CREATE UNIQUE INDEX idx_broadcast_correction_origin ON broadcast_sender_corrections(correction_of_broadcast_id)
  WHERE correction_of_broadcast_id IS NOT NULL;
