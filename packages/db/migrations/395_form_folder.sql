-- N-175 (#805 案A): フォームのフォルダ所属。folders(kind='form')のidを指す。
-- 既存行はNULLのまま(未分類として扱う)。PRAGMAは使わない。

ALTER TABLE forms ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
