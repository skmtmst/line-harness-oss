-- 送信の出どころ。
--
-- messages_log は「送った」ことしか持っていない。テンプレート由来なのか、
-- シナリオ由来なのか、一斉配信なのかが分からない。
--
-- そのせいで次が出せない（docs/v025-open-questions.md §A）。
--   ・テンプレートの「今月の送信」    … いまは全送信を出している
--   ・シナリオの「今週の配信」        … 出せない
--   ・リマインダの「今月の配信」      … 出せない
--   ・ダッシュボードの「プッシュ数 / リプライ数」… 区別できない
--
-- 1列で4か所が解ける。
--
-- 過去ぶんは埋まらない。入れた日から先だけ正しくなる。埋めようとすると
-- 各配信の送信履歴を突き合わせることになり、そこまでの価値は無い。
ALTER TABLE messages_log ADD COLUMN origin_kind TEXT;
ALTER TABLE messages_log ADD COLUMN origin_id TEXT;

-- 「この期間に、この種類で何通送ったか」が唯一の読み方。
CREATE INDEX IF NOT EXISTS idx_messages_log_origin
  ON messages_log (origin_kind, created_at);
