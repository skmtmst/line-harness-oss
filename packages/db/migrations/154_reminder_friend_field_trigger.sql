-- migration-policy: table-rebuild
--
-- 友だち情報欄の日付を、リマインダのゴールにできるようにする。
--
-- 画面には「誕生日や次回お届け日など、友だち情報欄の日付を起点にできます」と
-- 書いてあるのに、その経路が無かった。trigger_type は manual / booking / event の
-- 3つだけで、**誕生日リマインダは作れなかった**。
--
-- これが入ると、誕生日・次回お届け日・契約更新日が、この1つの形で全部作れる。
--
-- 増える列。
--   trigger_field_id  どの友だち情報欄を見るか（type='date' の欄）
--   repeat_yearly     毎年くり返すか。誕生日は 1、契約更新日は 0
--
-- SQLite は CHECK をあとから変えられないので、表を作り直す。落とすのと
-- 改名するのを同じファイルに書くのは、別ファイルにすると**その間で止まった
-- ときに表が無い状態で残る**ため。
CREATE TABLE reminders_new (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  line_account_id TEXT,
  trigger_type  TEXT NOT NULL DEFAULT 'manual'
                CHECK (trigger_type IN ('manual', 'booking', 'event', 'friend_field')),
  trigger_offset_minutes INTEGER,
  send_at_time  TEXT,
  target_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
  folder_id     TEXT REFERENCES folders(id) ON DELETE SET NULL,
  delivery_mode TEXT NOT NULL DEFAULT 'countdown',
  -- 154: 友だち情報欄の日付を起点にするときの設定
  trigger_field_id TEXT,
  repeat_yearly INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO reminders_new
  (id, name, description, is_active, line_account_id, trigger_type,
   trigger_offset_minutes, send_at_time, target_tag_id, folder_id,
   delivery_mode, created_at, updated_at)
SELECT
   id, name, description, is_active, line_account_id, trigger_type,
   trigger_offset_minutes, send_at_time, target_tag_id, folder_id,
   delivery_mode, created_at, updated_at
  FROM reminders;

DROP TABLE reminders;

ALTER TABLE reminders_new RENAME TO reminders;
