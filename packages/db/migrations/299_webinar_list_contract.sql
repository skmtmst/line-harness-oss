-- 299: V6 ウェビナー一覧のフォルダと公開期間。
--
-- 一覧でフォルダ名・公開期間・公開状態を実データから返すための保存欄。
-- フォルダ削除時もウェビナー本体は残し、未分類へ戻す。

ALTER TABLE webinars
  ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE webinars
  ADD COLUMN publication_starts_at TEXT;
ALTER TABLE webinars
  ADD COLUMN publication_ends_at TEXT;

CREATE INDEX IF NOT EXISTS idx_webinars_account_status_folder
  ON webinars (account_id, status, folder_id);
