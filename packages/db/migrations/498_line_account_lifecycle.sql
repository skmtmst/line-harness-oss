-- X-1: 停止・再開の理由 / X-2: 自動切替の履歴 / X-3: login_channel_secret の暗号化
-- 追加のみ（CREATE TABLE・ADD COLUMN・CREATE INDEX）。

ALTER TABLE line_accounts ADD COLUMN inactive_reason TEXT
  CHECK (inactive_reason IS NULL OR inactive_reason IN ('manual', 'ban_detected', 'credential_invalid'));
ALTER TABLE line_accounts ADD COLUMN inactive_reason_detail TEXT;
ALTER TABLE line_accounts ADD COLUMN inactivated_at TEXT;
ALTER TABLE line_accounts ADD COLUMN login_channel_secret_encrypted TEXT;
ALTER TABLE line_accounts ADD COLUMN last_webhook_received_at TEXT;
ALTER TABLE line_accounts ADD COLUMN webhook_silence_exempt INTEGER NOT NULL DEFAULT 0
  CHECK (webhook_silence_exempt IN (0, 1));

-- 「止めていたので送らなかった」の一覧。予約 job 自体は消さず、
-- ここに理由つきで残す（v6-33 §10-1）。同じ job を二度並べないよう UNIQUE。
CREATE TABLE account_skipped_deliveries (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  ref_id          TEXT NOT NULL,
  title           TEXT,
  reason          TEXT NOT NULL DEFAULT 'account_inactive',
  skipped_at      TEXT NOT NULL,
  UNIQUE (kind, ref_id)
);
CREATE INDEX idx_account_skipped_deliveries_account
  ON account_skipped_deliveries(line_account_id, skipped_at DESC);

-- プールの自動切替履歴（v6-33 §11-2）。危ない→予備へ出す(out)、
-- 24時間正常が続いたら戻す(in)。人が止めたプール参加と区別するための台帳。
CREATE TABLE account_pool_switch_events (
  id              TEXT PRIMARY KEY,
  pool_id         TEXT NOT NULL REFERENCES traffic_pools(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  reason          TEXT NOT NULL,
  actor           TEXT NOT NULL DEFAULT 'system',
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_account_pool_switch_events_account
  ON account_pool_switch_events(line_account_id, created_at DESC);
