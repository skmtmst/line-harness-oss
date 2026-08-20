-- migration-policy: table-rebuild
--
-- リマインダでも、シナリオや一斉配信と同じ8種別を送れるようにする。
--
-- これまで持てたのは text / image / flex の3つだけだった。シナリオは 137〜141 で、
-- 一斉配信は 142〜146 で、位置情報・動画・音声・スタンプ・カルーセルまで送れる
-- ようになっているのに、リマインダだけ取り残されていた。
--
-- 組み立てそのものは、自前で持っていた22行を共通のもの（line-message.ts）へ
-- 寄せ済み。あとは CHECK を広げれば届く。
--
-- SQLite は CHECK をあとから変えられないので、表を作り直す。落とすのと
-- 改名するのは同じファイルに書く。別ファイルにすると、その間で止まったときに
-- 表が無い状態で残る。
CREATE TABLE reminder_steps_new (
  id              TEXT PRIMARY KEY,
  reminder_id     TEXT NOT NULL REFERENCES reminders (id) ON DELETE CASCADE,
  offset_minutes  INTEGER NOT NULL,
  message_type    TEXT NOT NULL CHECK (message_type IN (
                    'text', 'image', 'flex', 'location', 'video', 'audio', 'sticker', 'carousel'
                  )),
  message_content TEXT NOT NULL,
  offset_days     INTEGER,
  send_at_time    TEXT,
  template_id     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO reminder_steps_new
  (id, reminder_id, offset_minutes, message_type, message_content,
   offset_days, send_at_time, template_id, created_at)
SELECT
   id, reminder_id, offset_minutes, message_type, message_content,
   offset_days, send_at_time, template_id, created_at
  FROM reminder_steps;

DROP TABLE reminder_steps;

ALTER TABLE reminder_steps_new RENAME TO reminder_steps;

-- 索引を貼り直す。**名前を毎回変えること。** 適用の要否を「いま索引があるか」で
-- 判定する仕組みは、表を落とす前の状態を見て「もうある」と判断して飛ばす。
-- 飛ばされると索引が消えたまま戻らない（136 で実際に踏んだ）。
CREATE INDEX IF NOT EXISTS idx_reminder_steps_by_reminder ON reminder_steps (reminder_id);
