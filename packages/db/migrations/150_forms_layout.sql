-- 150_forms_layout.sql
-- 回答フォームの中身を、平らな項目配列（fields）からレイアウトへ広げる。
--
-- layout には共通ヘッダ・セクション（ページ）・ブロック・選択肢ごとの動作・
-- オプション設定が JSON で入る。NULL のフォームは、これまでどおり fields
-- だけを見る（画面側が開いたときに layout へ持ち上げる）。
--
-- fields は残す。保存のたびに layout の入力欄から作り直して書き戻すので、
-- 送信時の必須チェック・回答一覧の見出し・友だち詳細はそのまま動く。

ALTER TABLE forms ADD COLUMN layout TEXT;

-- 1人1回・回答期限・総数制限を送信時に判定するため、friend_id で引く。
CREATE INDEX IF NOT EXISTS idx_form_submissions_form_friend
  ON form_submissions (form_id, friend_id);
