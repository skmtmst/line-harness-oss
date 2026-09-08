-- フォーム回答の冪等予約表(#646)。
--
-- Webhook・LINE通知などの外部副作用より前にこの行を原子的に確保し、
-- 同時送信の片方だけが処理を進める。scope は
-- (テナント・LINEアカウント・フォーム・友だち・キー)で、別 scope の
-- 同じキーは独立に成功し、同 scope の別内容は 409 で断る。
--
-- status は in_progress(処理中)/failed(失敗・即時再開可)/completed(完了・
-- 保存済みを返す)。回答 INSERT・件数更新・各副作用の途中失敗は failed に
-- 残し、同じキーでの再送が成功済み以外の工程を補完する。工程の記録は
-- steps(JSON 配列)、Webhook の結果は webhook(JSON)に置く。
-- expires_at を過ぎた completed の再送は、新しいキーでの送り直しを求める。
CREATE TABLE IF NOT EXISTS form_submit_claims (
  tenant_id TEXT NOT NULL DEFAULT '',
  line_account_id TEXT NOT NULL,
  form_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'failed', 'completed')),
  steps TEXT NOT NULL DEFAULT '[]',
  webhook TEXT,
  submission_id TEXT,
  owner TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, line_account_id, form_id, friend_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_form_submit_claims_updated
  ON form_submit_claims (updated_at);
CREATE INDEX IF NOT EXISTS idx_form_submit_claims_submission
  ON form_submit_claims (submission_id);
