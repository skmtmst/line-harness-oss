-- 広告送信の確保トークンと媒体側安定IDの保持(#638 差し戻し3回目)。
-- lease_token: 送信権の持ち主を示す。確保・取直しのたびに新しい値を入れ、
--   確定は持ち主の値と pending の両方を条件にする。古い持ち主の確定は通らない。
-- provider_event_id: 媒体側の重複排除ID。初回確保時に決めて行に残し、
--   再送・設定付け替え後も同じ値を使い続ける。
ALTER TABLE ad_conversion_logs ADD COLUMN lease_token TEXT;
ALTER TABLE ad_conversion_logs ADD COLUMN provider_event_id TEXT;
