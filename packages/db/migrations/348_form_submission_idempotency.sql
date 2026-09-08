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
--
-- version は横取りの楽観ロック(CAS)に使う。読み取った version と一致
-- するときだけ所有者を書き換え・工程を記録し、古い試行の書き込みは
-- 捨てる。lease_generation は横取りのたびに増える世代番号で、副作用の
-- 重ね掛けを防ぐ柵にする。effect_stats は layout の効果ごとの集計 JSON
-- ({効果id: {attempted, succeeded, failed}})で、再開時の合計表示に使う。
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
  version INTEGER NOT NULL DEFAULT 1,
  lease_generation INTEGER NOT NULL DEFAULT 1,
  effect_stats TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, line_account_id, form_id, friend_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_form_submit_claims_updated
  ON form_submit_claims (updated_at);
CREATE INDEX IF NOT EXISTS idx_form_submit_claims_submission
  ON form_submit_claims (submission_id);
-- Webhook 配達の durable outbox(#646)。
--
-- 外部 Webhook は「呼んでから結果を残す」までに落ちると、再開時に呼び
-- 直しになる。呼び直しを安全にするため、呼ぶ前に安定した event_id で
-- 意図行を作り、配達後に結果ごと delivered にする。event_id は予約の
-- scope とキーから決まる固定 UUID で、呼び直しも同じ値を送る
-- (X-Form-Event-Id)。受け側はこの値で重複を除ける。
CREATE TABLE IF NOT EXISTS form_submit_outbox (
  tenant_id TEXT NOT NULL DEFAULT '',
  line_account_id TEXT NOT NULL,
  form_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed')),
  payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, line_account_id, form_id, friend_id, idempotency_key, kind)
);
