-- 差し込み配信の再開時は、受信者ごとに既送信ログを照合する。
-- 配信全体のログを毎回たどらず、照合する3条件から1行へ絞り込む。
CREATE INDEX IF NOT EXISTS idx_messages_log_broadcast_friend_direction
  ON messages_log (broadcast_id, friend_id, direction);
