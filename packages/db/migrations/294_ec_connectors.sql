-- ECの接続先をLINEアカウントごとに管理し、秘密値は暗号文と末尾4文字だけを保存する。
CREATE TABLE IF NOT EXISTS ec_connectors (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('ec_cube', 'shopify')),
  shop_domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'degraded', 'paused', 'auth_expired', 'rate_limited')),
  inbound_secret_encrypted TEXT,
  inbound_secret_last4 TEXT,
  secret_updated_at TEXT,
  event_types_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(event_types_json) AND json_type(event_types_json) = 'array'),
  identity_rules_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(identity_rules_json) AND json_type(identity_rules_json) = 'array'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (line_account_id)
);

CREATE INDEX IF NOT EXISTS idx_ec_connectors_status
  ON ec_connectors(status, updated_at DESC);
