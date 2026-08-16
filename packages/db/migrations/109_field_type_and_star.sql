-- 友だち情報欄の型と、よく見る印。
--
-- friend_fields は文字列しか持たない。そのため次が出せない
-- （docs/v025-open-questions.md §D / §18-2）。
--   ・リマインダの「起点になる項目」… 日付型を数えられない
--   ・友だち情報欄の「種別」列      … 単一行 / 電話番号 などが出せない
--   ・入力欄が全部ただの文字入力になる（日付でもカレンダーが出ない）
--
-- 既定は 'text'。いまの項目はすべて文字列として扱われているので、
-- 既定を入れても今日の動きは変わらない。
ALTER TABLE friend_fields ADD COLUMN field_type TEXT NOT NULL DEFAULT 'text';

-- よく見る印。友だち詳細の「★つき友だち情報」に出す。
--
-- 項目が20を超えると、詳細を開いても目的の値がすぐ見つからない。
-- 上位N件を機械的に出すより、人が選べる方がよい。
ALTER TABLE friend_fields ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0;
