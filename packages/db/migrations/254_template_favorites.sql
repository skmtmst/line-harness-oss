-- テンプレート一覧の「よく使う」を、名前の決め打ちではなく実データにする。
-- 既存テンプレートはお気に入りではない状態から始め、運用者が一覧の星で選ぶ。
ALTER TABLE templates
  ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_templates_account_favorite_updated
  ON templates(line_account_id, is_favorite, updated_at DESC);
