-- 461: 写真の重複判定のための hash (#817)。
-- 完全に同じ写真は中身の hash で「重複」とする。
-- 似ている写真は自動で却下せず、「注意」の札だけに留める。
-- hash は投稿の受付時にサーバーが付ける。古い投稿は空のままにし、
-- 空の hash 同士を重複としない（無い番号をでっち上げない）。
ALTER TABLE nen_photo_submissions ADD COLUMN content_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_photo_submissions_content_hash
  ON nen_photo_submissions (line_account_id, content_hash);
