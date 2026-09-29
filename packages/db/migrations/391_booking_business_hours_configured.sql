-- 店舗営業時間が管理画面から一度でも明示保存されたかを区別する。
-- 既存店舗の0行曜日は後方互換で制限なし、保存後の0行曜日だけ休業にする。
ALTER TABLE booking_settings
  ADD COLUMN business_hours_configured INTEGER NOT NULL DEFAULT 0
  CHECK (business_hours_configured IN (0, 1));
