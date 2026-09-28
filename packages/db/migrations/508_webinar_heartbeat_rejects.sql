-- 508: ウェビナー heartbeat の異常値の除外記録 (J #821)。
--
-- サーバー受信時刻を基準に、位置の進みが経過時間の2倍を超える
-- heartbeat は異常として区間に数えず、ここに理由と一緒に残す。
-- 異常が多いときの警告の母数にする。付け足すだけ。

CREATE TABLE IF NOT EXISTS webinar_heartbeat_rejects (
  id TEXT PRIMARY KEY,
  webinar_id TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  session_start_at INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('position_jump', 'negative_gap', 'invalid_rate')),
  position_seconds INTEGER NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webinar_heartbeat_rejects_webinar
  ON webinar_heartbeat_rejects (webinar_id, received_at);
