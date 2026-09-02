-- 飲食店向け予約メール原文のR2保存台帳。
-- 本文はD1に持たず、非公開R2のキーと処理状態だけを保持する。

CREATE TABLE IF NOT EXISTS rt_inbound_emails (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  store_id TEXT REFERENCES rt_stores(id) ON DELETE SET NULL,
  r2_key TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'storing'
    CHECK (status IN ('storing', 'stored', 'received', 'quarantined', 'storage_failed', 'raw_deleted')),
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  quarantine_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_rt_inbound_emails_store
  ON rt_inbound_emails (store_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_rt_inbound_emails_retention
  ON rt_inbound_emails (received_at, status);
