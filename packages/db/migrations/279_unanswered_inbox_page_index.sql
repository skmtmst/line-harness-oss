-- 未対応一覧は、解決済みを除いた「最後の要対応受信」を新しい順にページ取得する。
-- 全メッセージ履歴の再集計をやめ、チャットの受信時投影から直接たどれるようにする。
CREATE INDEX IF NOT EXISTS idx_chats_unanswered_page
  ON chats (last_customer_message_at DESC, friend_id DESC)
  WHERE status != 'resolved' AND last_customer_message_at IS NOT NULL;

-- ページ内だけに出す「自動処理後」の印も、友だちごとの最新1件へ索引で到達する。
CREATE INDEX IF NOT EXISTS idx_messages_log_friend_direction_source_created
  ON messages_log (friend_id, direction, source, created_at DESC);
