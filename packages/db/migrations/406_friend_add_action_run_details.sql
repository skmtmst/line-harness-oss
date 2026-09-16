-- N-102/N-103: 友だち追加時に実行した各処理を、公開版の固定内容と一緒に残す。
-- 失敗分だけを安全に再試行できるよう、処理種別・固定内容・開始/完了時刻を足す。

ALTER TABLE friend_add_action_runs ADD COLUMN action_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE friend_add_action_runs ADD COLUMN action_snapshot TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(action_snapshot));
ALTER TABLE friend_add_action_runs ADD COLUMN started_at TEXT;
ALTER TABLE friend_add_action_runs ADD COLUMN completed_at TEXT;

-- 処理失敗を直した後、送信側の元の結末（成功/抑止/送信失敗）へ戻すための控え。
ALTER TABLE friend_add_events ADD COLUMN action_base_status TEXT
  CHECK (action_base_status IS NULL OR action_base_status IN ('pending', 'completed', 'failed', 'suppressed', 'partial_failed'));
ALTER TABLE friend_add_events ADD COLUMN action_base_error_code TEXT;
