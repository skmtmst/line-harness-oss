-- メディア差し替えの互換性判定材料。版追加の前に「同じ種類か」だけでなく
-- 寸法・長さ・ページ数・codecを比べるため、アップロード予約にも内容情報を
-- 残せるようにする。追加列のみのため表の作り直しはしない。

ALTER TABLE media_upload_sessions ADD COLUMN width INTEGER
  CHECK (width IS NULL OR width > 0);
ALTER TABLE media_upload_sessions ADD COLUMN height INTEGER
  CHECK (height IS NULL OR height > 0);
ALTER TABLE media_upload_sessions ADD COLUMN duration_ms INTEGER
  CHECK (duration_ms IS NULL OR duration_ms > 0);
ALTER TABLE media_upload_sessions ADD COLUMN page_count INTEGER
  CHECK (page_count IS NULL OR page_count > 0);
ALTER TABLE media_upload_sessions ADD COLUMN codec TEXT;
