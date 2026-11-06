-- 席予約の遅刻案内。未設定の店には案内を出さない。
ALTER TABLE rt_opening_hours_settings ADD COLUMN late_cancel_after_minutes INTEGER CHECK(late_cancel_after_minutes BETWEEN 1 AND 1440);
ALTER TABLE rt_opening_hours_settings ADD COLUMN late_arrival_message TEXT CHECK(length(late_arrival_message)<=1000);
