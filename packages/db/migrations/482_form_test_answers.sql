-- P（回答フォームの公開前の試し）：試しの回答の区別と、試し合言葉の台帳。
--
-- 試しの回答は集計に入れず、回答後アクションも動かさない。そのため
-- 本物の回答と行で区別する `is_test` を持たせる（既存行は 0＝本物）。
-- 公開前の下書きをお客さま画面で開く合言葉は `form_test_tokens` に置く。
-- 生の合言葉は保存せず、SHA-256 の16進だけを残す。期限切れは使えない。

ALTER TABLE form_submissions
  ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0
  CHECK (is_test IN (0, 1));

CREATE TABLE IF NOT EXISTS form_test_tokens (
  id                  TEXT PRIMARY KEY,
  form_id             TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  token_hash          TEXT NOT NULL UNIQUE,
  created_by_staff_id TEXT,
  expires_at          TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_test_month
  ON form_submissions(form_id, is_test, created_at);
CREATE INDEX IF NOT EXISTS idx_form_test_tokens_form
  ON form_test_tokens(form_id, expires_at);
