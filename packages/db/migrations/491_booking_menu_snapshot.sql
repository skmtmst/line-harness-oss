-- 491: 予約の写し (T: 予約の設定の版と予約の写し)。
-- 予約した時点のメニューの内容（値段・時間）を予約ごとに残す。
-- あとでメニューを変えても、この予約の写しは変わらない。
-- 空（NULL）は「写しなし」（490 より前に取った予約）。画面では「—」と出す。
ALTER TABLE bookings
  ADD COLUMN menu_version_number INTEGER CHECK (menu_version_number IS NULL OR menu_version_number > 0);
ALTER TABLE bookings
  ADD COLUMN menu_snapshot_json TEXT CHECK (menu_snapshot_json IS NULL OR json_valid(menu_snapshot_json));
CREATE INDEX IF NOT EXISTS idx_bookings_menu_version
  ON bookings (menu_id, menu_version_number);
