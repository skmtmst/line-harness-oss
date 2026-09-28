-- 478: ウェビナー動画の準備の段 (N)。
--
-- 動画は「検査 → 変換 → 配信の形 → 表紙」の段を通す。
-- 準備 (ready) が済むまで配信に選べない。公開前検査は
-- ready の資産だけを通す。付け足すだけ。

CREATE TABLE IF NOT EXISTS webinar_video_assets (
  id TEXT PRIMARY KEY,
  webinar_id TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (stage IN (
      'uploaded', 'inspecting', 'converting', 'packaging',
      'thumbnail', 'ready', 'failed'
    )),
  provider TEXT NOT NULL DEFAULT 'r2_hls',
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  checksum TEXT,
  error_code TEXT,
  expires_at TEXT,
  purged_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webinar_video_assets_webinar
  ON webinar_video_assets (webinar_id, stage);

ALTER TABLE webinars
  ADD COLUMN video_asset_id TEXT REFERENCES webinar_video_assets(id) ON DELETE SET NULL;
