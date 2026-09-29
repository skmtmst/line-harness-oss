-- N-101(#622): 別webhook IDで並行に届いたfollowの二重送信を防ぐ送信権の予約。
-- (line_account_id, friend_id) に1行だけ置き、先に置いた実行だけが進む。
-- event_id が持ち主、generation が世代。回収（奪い直し）で世代が進み、
-- 古い持ち主の送信・確定は世代で弾く（fencing）。予約は台帳（completed /
-- partial_failed）の確定まで掴んだままにし、確定できなかったときは掴んだまま
-- 残す（送達不明）。並行する実行は引くため、外部送信のあとDBが落ちても
-- 別の実行が二重に送らない。処理が終われば予約を消す。
--
-- dispatched_at は「外部へ送り始めた」印。送信のひとつ手前で立て、
-- 回収（奪い直し）のときも消さない。前の持ち主が送信の途中で消えた場合、
-- 奪った側はこの印を見て**送らない**。印が残っているということは
-- 「送ったかもしれない」であり、送り直すと同じ人へ2通届く。
-- 正常に終われば予約ごと消えるので、印も残らない。

CREATE TABLE IF NOT EXISTS friend_add_send_claims (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id       TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  event_id        TEXT NOT NULL,
  generation      INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
  claimed_at      TEXT NOT NULL,
  dispatched_at   TEXT,
  PRIMARY KEY (line_account_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_add_send_claims_stale
  ON friend_add_send_claims(claimed_at);
