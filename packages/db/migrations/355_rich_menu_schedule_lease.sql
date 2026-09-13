-- E-08 (#621 独立再審査③): 所有run付き期限lease。
-- claim時にそのrunの期限を刻み、回収は期限切れの行だけ戻す。
-- 成功・失敗の確定時はleaseを空け、古いrunの書き込みを期限でも弾く。
-- 時刻はUTCのISO8601('Z')でそろえ、文字列比較で順序が崩れないようにする。
ALTER TABLE rich_menu_schedules ADD COLUMN lease_expires_at TEXT;
CREATE INDEX IF NOT EXISTS idx_rich_menu_schedules_lease
  ON rich_menu_schedules (status, lease_expires_at);
