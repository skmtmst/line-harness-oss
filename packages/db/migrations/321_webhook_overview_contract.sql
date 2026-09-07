-- 機能26: 受信口の設定版と、値を持たない最新サンプル。
-- raw payload と secret はこの列へ保存しない。

ALTER TABLE incoming_webhooks ADD COLUMN version INTEGER NOT NULL DEFAULT 1
  CHECK (version > 0);
ALTER TABLE incoming_webhooks ADD COLUMN identity_match_json TEXT NOT NULL DEFAULT
  '{"methods":[],"onNotFound":"do_nothing"}';
ALTER TABLE incoming_webhooks ADD COLUMN action_refs_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE incoming_webhooks ADD COLUMN latest_masked_sample_json TEXT;
ALTER TABLE incoming_webhooks ADD COLUMN latest_received_at TEXT;

CREATE INDEX IF NOT EXISTS idx_webhook_interactions_connection_period
  ON webhook_interaction_logs(line_account_id, webhook_id, created_at DESC, status);
