-- 定期走査の整理で、新しい使用先を読み飛ばして古い行へ直接到達する。
CREATE INDEX IF NOT EXISTS idx_media_usages_media_scanned
  ON media_usages (media_id, scanned_at);
