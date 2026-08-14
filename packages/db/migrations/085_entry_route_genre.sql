-- リファラルリンクを協力会社・媒体グループなどのジャンルで整理する。
-- NULL は既存リンクの「未分類」を表し、既存データをそのまま維持する。
ALTER TABLE entry_routes ADD COLUMN genre TEXT;

CREATE INDEX IF NOT EXISTS idx_entry_routes_genre
  ON entry_routes (genre, created_at DESC);
