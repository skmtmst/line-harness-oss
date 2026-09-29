-- 479: ウェビナー開催回の定員と見逃し配信の期限 (N)。
--
-- 開催回の定員は申込の時に条件付き更新で確保する (満員なら申込不可)。
-- 行が無い開催回は従来どおり無制限。
-- 見逃し配信は「する」を選んだ時だけ、開催から一定日数以内の視聴に使う。
-- 付け足すだけ。既存の列を消さない・型を変えない。

CREATE TABLE IF NOT EXISTS webinar_sessions (
  id TEXT PRIMARY KEY,
  webinar_id TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  session_start_at INTEGER NOT NULL,
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
  reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  state TEXT NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'full', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (webinar_id, session_start_at)
);

CREATE INDEX IF NOT EXISTS idx_webinar_sessions_webinar
  ON webinar_sessions (webinar_id, session_start_at);

ALTER TABLE webinar_notification_settings
  ADD COLUMN missed_window_days INTEGER NOT NULL DEFAULT 7
  CHECK (missed_window_days BETWEEN 1 AND 30);
