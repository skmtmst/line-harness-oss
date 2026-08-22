-- 飲食店向け予約メールの取り込みアドレス。
-- catch-all で受けた宛先の推測困難なローカル部から店舗を特定する。

CREATE TABLE IF NOT EXISTS rt_intake_addresses (
  id TEXT PRIMARY KEY,
  local_part TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rt_intake_addresses_store
  ON rt_intake_addresses (store_id, status);
