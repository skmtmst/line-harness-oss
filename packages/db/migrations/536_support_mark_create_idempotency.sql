-- 対応マーク作成の再試行で二重に作らないための要求キー台帳（R512）。
--
-- 同じ Idempotency-Key の再送は保存済みのマークを返し、同じキーに
-- 異なる内容が来たら作らず止める。付け足すだけの表で、既存の列は触らない。
CREATE TABLE IF NOT EXISTS support_mark_create_requests (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id),
  idempotency_key   TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  mark_id           TEXT NOT NULL REFERENCES support_marks(id),
  response_json     TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at        TEXT NOT NULL,
  UNIQUE(line_account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_support_mark_create_requests_mark
  ON support_mark_create_requests(line_account_id, mark_id, created_at DESC);
