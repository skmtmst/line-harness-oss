-- N-417: 開催回の申込者表示・CSV・一斉案内で同じ対象を読む短期snapshot。
-- 表示後の申込/取消で、確認済みの対象が入れ替わらないようにする。
CREATE TABLE event_occurrence_applicant_snapshots (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  occurrence_id   TEXT NOT NULL REFERENCES event_slots(id) ON DELETE CASCADE,
  staff_id        TEXT NOT NULL,
  payload_json    TEXT NOT NULL CHECK (json_valid(payload_json)),
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_event_occurrence_applicant_snapshots_scope_expiry
  ON event_occurrence_applicant_snapshots(line_account_id, occurrence_id, staff_id, expires_at);
