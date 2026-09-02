-- friends に line_account_id のインデックスが無かった。
-- ほぼ全画面がこの列で絞り込むのに、毎回テーブル全体を見ていた。
--
-- 単独ではなく (line_account_id, created_at DESC) にしたのは、
-- 一覧の既定が「アカウントで絞って新しい順」だから。並べ替えまで
-- インデックスで賄えると、絞り込みのあとの並べ替えが不要になる。
CREATE INDEX IF NOT EXISTS idx_friends_account_created
  ON friends(line_account_id, created_at DESC);
