-- 同時編集の見分け用。最終更新日時。書き換え時に口が入れる。既存行は NULL のまま。
ALTER TABLE affiliates ADD COLUMN updated_at TEXT;
