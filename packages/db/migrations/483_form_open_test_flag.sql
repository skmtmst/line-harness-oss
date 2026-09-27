-- P（回答フォームの公開前の試し）：試しの「開いた記録」の区別。
--
-- 完了率 ＝ 今月の回答完了 ÷ 今月開いた人。試しで開いた分を分母に混ぜると
-- 率が下がるため、開いた記録にも `is_test` を持たせる（既存行は 0＝本物）。

ALTER TABLE form_opens
  ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0
  CHECK (is_test IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_form_opens_test_month
  ON form_opens(form_id, is_test, opened_at);
