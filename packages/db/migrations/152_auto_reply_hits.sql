-- 自動応答が当たった記録。
--
-- 一覧に「35回（累計 35）」と出すため。どのルールがよく当たっているかが
-- 見えないと、キーワードの調整ができない。
--
-- 1回ごとに1行残す。件数だけを列で持つ方法もあるが、それだと「今月」が
-- 出せない。リッチメニューの押された回数（148）と同じ作りにそろえる。
--
-- 「1人につき1回だけ応答する」（151 の once_per_friend）の判定にも、この表を使う。
-- friend_id で1行でも見つかれば、もう応答しない。
--
-- 外部キーは張らない。ルールを消しても、当たった事実は残す。
-- 消したあとに「先月いちばん当たっていたルール」を振り返れなくなるため。
-- 当たった時点のキーワードを写しておくのも同じ理由。
CREATE TABLE IF NOT EXISTS auto_reply_hits (
  id              TEXT PRIMARY KEY,
  auto_reply_id   TEXT NOT NULL,
  friend_id       TEXT,
  line_account_id TEXT,
  matched_keyword TEXT,
  hit_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- 一覧のヒット数（ルール別・期間別）。
CREATE INDEX IF NOT EXISTS idx_auto_reply_hits_rule ON auto_reply_hits(auto_reply_id, hit_at);
-- 「1人につき1回」の判定。
CREATE INDEX IF NOT EXISTS idx_auto_reply_hits_friend ON auto_reply_hits(auto_reply_id, friend_id);
