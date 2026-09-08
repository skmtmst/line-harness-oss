-- N-101(#622): 別webhook IDで並行に届いたfollowの二重送信を防ぐ送信権の予約表。
-- (line_account_id, friend_id) に1行だけ置き、先に置いた実行だけが即時送信する。
-- 処理が終われば予約を消す。落ちて残った予約は古くなれば奪い直せる。

CREATE TABLE IF NOT EXISTS friend_add_send_claims (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id       TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  event_id        TEXT NOT NULL,
  claimed_at      TEXT NOT NULL,
  PRIMARY KEY (line_account_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_add_send_claims_stale
  ON friend_add_send_claims(claimed_at);
