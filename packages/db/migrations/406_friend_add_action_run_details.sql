-- N-102/N-103: 友だち追加時に実行した各処理を、公開版の固定内容と一緒に残す。
-- 失敗分だけを安全に再試行できるよう、処理種別・固定内容・開始/完了時刻を足す。

ALTER TABLE friend_add_action_runs ADD COLUMN action_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE friend_add_action_runs ADD COLUMN action_snapshot TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(action_snapshot));
ALTER TABLE friend_add_action_runs ADD COLUMN started_at TEXT;
ALTER TABLE friend_add_action_runs ADD COLUMN completed_at TEXT;

