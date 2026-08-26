-- V6分析のURL露出。
-- 既存のmessages_logを送信事実、tracked_linksをURL正本として再利用し、
-- 「どの計測URLが誰へ届いたか」という欠けていた関係だけを追記する。

CREATE TABLE IF NOT EXISTS analytics_url_exposures (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  message_id      TEXT NOT NULL,
  friend_id       TEXT REFERENCES friends(id) ON DELETE SET NULL,
  tracked_link_id TEXT NOT NULL,
  source_kind     TEXT NOT NULL,
  source_id       TEXT,
  audience_state  TEXT NOT NULL DEFAULT 'known'
                  CHECK (audience_state IN ('known','unknown')),
  sent_at         TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (line_account_id, message_id, tracked_link_id)
);

CREATE INDEX IF NOT EXISTS idx_analytics_url_exposures_link_time
  ON analytics_url_exposures(line_account_id, tracked_link_id, sent_at, friend_id);
CREATE INDEX IF NOT EXISTS idx_analytics_url_exposures_friend_time
  ON analytics_url_exposures(line_account_id, friend_id, sent_at)
  WHERE friend_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS analytics_url_exposure_queue (
  message_id            TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','processing','processed','failed')),
  attempts              INTEGER NOT NULL DEFAULT 0,
  available_at          TEXT NOT NULL,
  processing_started_at TEXT,
  processed_at          TEXT,
  last_error            TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_url_exposure_queue_due
  ON analytics_url_exposure_queue(status, available_at, created_at)
  WHERE status IN ('pending','failed');

-- 導入時刻より前を「届かなかった」と誤判定しないため、既存アカウントは
-- トリガーを有効にするこの時点を取得開始として固定する。過去ログは遡って作らない。
INSERT OR IGNORE INTO analytics_event_coverage (
  line_account_id, event_type, available_from, state, updated_at
)
SELECT id,
       'url_exposed',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       'available',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM line_accounts;

-- 送信処理ごとに同じ配線を増やさない。送信成功後のmessages_logを入口にし、
-- 本文の解析はCronへ逃がしてLINE送信を遅くしない。
CREATE TRIGGER IF NOT EXISTS trg_messages_log_queue_url_exposure
AFTER INSERT ON messages_log
WHEN NEW.direction = 'outgoing'
 AND instr(NEW.content, '/t/') > 0
 AND COALESCE(
       NEW.line_account_id,
       (SELECT line_account_id FROM friends WHERE id = NEW.friend_id)
     ) IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO analytics_url_exposure_queue (
    message_id, line_account_id, status, attempts, available_at, created_at, updated_at
  ) VALUES (
    NEW.id,
    COALESCE(
      NEW.line_account_id,
      (SELECT line_account_id FROM friends WHERE id = NEW.friend_id)
    ),
    'pending', 0, NEW.created_at, NEW.created_at, NEW.created_at
  ); END;
