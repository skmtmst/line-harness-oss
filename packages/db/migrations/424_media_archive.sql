-- メディアのアーカイブ。不要になった画像・ファイルを一覧から安全に
-- 退避し、誰が・いつ・なぜ退避したかを残せるようにする。
-- 使い終わったメディアを消すと、送信中の本文や過去の配信が壊れるため、
-- 削除とは別に「一覧から隠すが参照は残る」状態を用意する。
-- 追加列のみのため表の作り直しはしない。

ALTER TABLE media ADD COLUMN archived_at TEXT;
ALTER TABLE media ADD COLUMN archived_by TEXT;
ALTER TABLE media ADD COLUMN archive_reason TEXT;

-- 一覧は「archived_at が無いもの」だけを既定で読むため、
-- アカウント内の未アーカイブ行へ速く届く索引を張る。
CREATE INDEX idx_media_account_archived_v424
  ON media(line_account_id, archived_at);
