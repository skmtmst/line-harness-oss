-- Dashboard filters by account and time; keep those filters index-backed as data grows.
CREATE INDEX IF NOT EXISTS idx_friends_account_created
  ON friends(line_account_id, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_account_direction_created
  ON messages_log(line_account_id, direction, created_at);

CREATE INDEX IF NOT EXISTS idx_conversion_events_created_friend
  ON conversion_events(created_at, friend_id);

CREATE INDEX IF NOT EXISTS idx_chats_friend_status_message
  ON chats(friend_id, status, last_message_at);
