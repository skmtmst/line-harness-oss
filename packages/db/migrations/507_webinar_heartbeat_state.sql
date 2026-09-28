-- 507: ウェビナー heartbeat の再生状態と受信時刻 (J #821)。
--
-- 再生中だけを有効な視聴として数えるため、区間の行に速度と
-- 申告時刻を残す。一次停止・非表示・読み込み待ち・移動中の
-- heartbeat は区間を作らず、視聴者行の受信時刻だけを進める。
-- 付け足すだけ。既存の列を消さない・型を変えない。

ALTER TABLE webinar_view_segments
  ADD COLUMN playback_rate REAL NOT NULL DEFAULT 1
  CHECK (playback_rate > 0 AND playback_rate <= 4);

ALTER TABLE webinar_view_segments
  ADD COLUMN client_at_ms INTEGER;

ALTER TABLE webinar_viewers
  ADD COLUMN last_heartbeat_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_webinar_view_segments_rate
  ON webinar_view_segments (webinar_id, playback_rate);
