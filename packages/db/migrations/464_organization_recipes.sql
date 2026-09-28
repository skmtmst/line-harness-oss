-- V6 機能34: 組織レシピ（§7-5、§11-1）。
--
-- 初期同梱（builtin）は全組織で共通。組織が作ったレシピ（org）は
-- 作った組織の LINE アカウントの範囲だけに見える。
-- NULL = 全組織共通（builtin）、値あり = そのアカウントの組織レシピ。

ALTER TABLE recipes ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL;
ALTER TABLE recipes ADD COLUMN created_by_staff_id TEXT;

CREATE INDEX idx_recipes_v464_account ON recipes(line_account_id);
