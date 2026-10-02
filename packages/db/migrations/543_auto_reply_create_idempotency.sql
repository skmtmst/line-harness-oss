-- 自動応答の作成・複製の再試行で二重に作らないための要求キー台帳（m26c R556/R570）。
--
-- 同じ Idempotency-Key の再送は保存済みの応答を返し、同じキーに
-- 異なる内容が来たら作らず止める。付け足すだけの表で、既存の列は触らない。
-- 対応マーク（536）・友だち情報欄（537）と同じ約束だが、直接作成と
-- 下書き付き作成の両方を同じ表で受け、操作（operation）の取り違えも止める。
-- 共通ルールの line_account_id が NULL でも重複を防げるよう、
-- キーは表全体で一意にする（NULL 同士は別物とみなされるため、
-- 対象別の複合一意では共通ルールの二重作成を防げない）。
CREATE TABLE IF NOT EXISTS auto_reply_create_requests (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT REFERENCES line_accounts(id),
  operation         TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  auto_reply_id     TEXT NOT NULL REFERENCES auto_replies(id) ON DELETE CASCADE,
  version_id        TEXT REFERENCES auto_reply_versions(id) ON DELETE SET NULL,
  response_json     TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at        TEXT NOT NULL,
  UNIQUE(idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_auto_reply_create_requests_rule
  ON auto_reply_create_requests(auto_reply_id, created_at DESC);
