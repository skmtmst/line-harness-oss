-- タグ編集の保存に要求キーを付け、応答消失後の再送を保存済みとして返す（M956）。
--
-- 同じキー・同じ内容の再送は保存済みの結果を返し、同じキーに異なる内容が
-- 来たら作らず止める。対応マーク（536）・友だち情報欄（537）の要求キー台帳
-- と同じ約束。付け足すだけの表で、既存の列は触らない。
CREATE TABLE IF NOT EXISTS tag_update_requests (
  id                  TEXT PRIMARY KEY,
  tag_id              TEXT NOT NULL REFERENCES tags(id),
  idempotency_key     TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  resulting_version   INTEGER NOT NULL,
  response_json       TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at          TEXT NOT NULL,
  UNIQUE(tag_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_tag_update_requests_tag
  ON tag_update_requests(tag_id, created_at DESC);
