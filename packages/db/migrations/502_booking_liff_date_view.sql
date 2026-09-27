-- LIFF 予約「日時を選ぶ」段の最初の形（リスト / カレンダー）。
-- 付け足しだけ。既存の列は触らない。
-- migration 前からある行は既定 'list'（いまと同じ見た目）になる。
ALTER TABLE booking_settings
  ADD COLUMN liff_date_view TEXT NOT NULL DEFAULT 'list'
  CHECK (liff_date_view IN ('list', 'calendar'));
