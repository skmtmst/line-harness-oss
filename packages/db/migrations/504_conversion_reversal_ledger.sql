-- 成果の取り消し台帳(#819)。元の成果は消さず、取り消しと
-- 取り消しの取り消しを理由付きの追記として残す。
-- 「いま取り消されているか」は、その成果のいちばん新しい行の kind で決める。

CREATE TABLE IF NOT EXISTS conversion_event_reversals (
  id                  TEXT PRIMARY KEY,
  conversion_event_id TEXT NOT NULL REFERENCES conversion_events(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('reverse', 'restore')),
  reason              TEXT NOT NULL,
  actor_id            TEXT,
  actor_name          TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_conversion_event_reversals_event
  ON conversion_event_reversals(conversion_event_id, created_at DESC);
