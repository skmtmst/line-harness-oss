-- 予約の写真を登録メディアから1枚ずつ選んで付ける（メニュー・スタッフ・お店）。
-- お店の写真は booking_settings に欄を足す。どの登録メディアを使っているかは
-- media_usages に残し、使っている写真は登録メディアから消せないようにする。
-- media_usages の ref_kind（CHECK制約）を足すため、表を作り直す。
-- migration-policy: table-rebuild
-- 登録メディアとの結び付けは台帳（media_usages）と保存時の検査で守る。
-- 外部キーにしない（staff_member_id と同じ形）。キーにすると、テナント削除で
-- media を先に消す順序とぶつかり、写真が残っているメニュー等で削除が止まる。
ALTER TABLE menus ADD COLUMN photo_media_id TEXT;
ALTER TABLE staff ADD COLUMN photo_media_id TEXT;
-- お店の写真は3枠（B-1『店の写真』：外観・店内・待合）。外観が store_photo_media_id。
-- 561はまだどのDBにも当てていないので、このファイルへ足す（562 は M3 が使う）。
ALTER TABLE booking_settings ADD COLUMN store_photo_media_id TEXT;
ALTER TABLE booking_settings ADD COLUMN store_photo_interior_media_id TEXT;
ALTER TABLE booking_settings ADD COLUMN store_photo_waiting_media_id TEXT;

CREATE TABLE media_usages_new (
  media_id   TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  ref_kind   TEXT NOT NULL CHECK (ref_kind IN (
               'template','broadcast','rich_menu','scenario_step',
               'nen_column','event','webinar',
               'booking_menu','booking_staff','booking_settings')),
  ref_id     TEXT NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  PRIMARY KEY (media_id, ref_kind, ref_id)
);
INSERT INTO media_usages_new (media_id, ref_kind, ref_id, scanned_at)
SELECT media_id, ref_kind, ref_id, scanned_at FROM media_usages;
DROP TABLE media_usages;
ALTER TABLE media_usages_new RENAME TO media_usages;
CREATE INDEX IF NOT EXISTS idx_media_usages_media_scanned
  ON media_usages (media_id, scanned_at);
