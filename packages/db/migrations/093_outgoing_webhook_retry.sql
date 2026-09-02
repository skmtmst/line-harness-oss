-- 送信Webhookの再送設定。失敗しても記録が残るだけで、
-- 送り直すかどうかを画面から決められなかった。

-- 何回まで送り直すか。既定0は従来どおり「送り直さない」。
ALTER TABLE outgoing_webhooks ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 0;

-- 連続失敗で自動停止した回数と時刻。運用で気づけるようにする。
ALTER TABLE outgoing_webhooks ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outgoing_webhooks ADD COLUMN last_failed_at TEXT;
