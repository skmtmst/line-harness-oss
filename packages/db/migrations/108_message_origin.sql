-- 使わない列を足してしまった。消せないので、なぜ使わないかを残す。
--
-- もともとは messages_log に「この送信は何由来か」を持たせるつもりだった。
-- しかし 028 で source が既にあり、038 で template_id_at_send もあった。
--
--   source              user / broadcast / scenario / auto_reply /
--                       reminder / manual
--   template_id_at_send 送信時に使ったテンプレート
--
-- つまり docs/v025-open-questions.md の「§A 送信の出どころを記録していない」は
-- 誤りだった。突き合わせ表を書いたときに実物を確かめず、
-- 「記録していない」と決めつけていた。
--
-- 検証環境には既に origin_kind / origin_id が入っている。追加のみのポリシーで
-- 列は消せないので、そのまま残る。**どこからも読み書きしない。**
-- 使うのは source と template_id_at_send。
--
-- 本番にはまだ当たっていない。当てても害は無い（NULL のまま）。
ALTER TABLE messages_log ADD COLUMN origin_kind TEXT;
ALTER TABLE messages_log ADD COLUMN origin_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_log_origin
  ON messages_log (origin_kind, created_at);
