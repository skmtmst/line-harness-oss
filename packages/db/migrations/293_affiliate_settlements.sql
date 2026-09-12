-- 成果報酬を後から再現できるよう、承認済み成果と支払い確定を追記で残す。
-- 銀行振込そのものは行わず、確定後の金額も書き換えない。

ALTER TABLE affiliates ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active'
  CHECK (lifecycle_status IN ('active', 'paused', 'archived'));
ALTER TABLE affiliates ADD COLUMN archived_at TEXT;

CREATE TABLE IF NOT EXISTS affiliate_reward_entries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  conversion_event_id TEXT NOT NULL REFERENCES conversion_events(id),
  offer_id TEXT REFERENCES affiliate_offers(id),
  offer_version_id TEXT,
  reward_calculation_id TEXT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('credit', 'debit')),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY' CHECK (currency = 'JPY'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'held', 'payable', 'settled', 'paid', 'reversed')),
  approved_at TEXT,
  payable_at TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (conversion_event_id, entry_type)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_reward_entries_scope_status
  ON affiliate_reward_entries(organization_id, line_account_id, affiliate_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS affiliate_adjustments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  source_entry_id TEXT REFERENCES affiliate_reward_entries(id),
  applied_settlement_id TEXT,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY' CHECK (currency = 'JPY'),
  reason_type TEXT NOT NULL CHECK (reason_type IN ('refund', 'cancel', 'manual')),
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'applied')),
  idempotency_key TEXT NOT NULL UNIQUE,
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS affiliate_settlements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  affiliate_id TEXT REFERENCES affiliates(id),
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  currency TEXT NOT NULL DEFAULT 'JPY' CHECK (currency = 'JPY'),
  total_amount_minor INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('preview', 'closed', 'exported', 'paid', 'partial', 'failed')),
  closed_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL UNIQUE,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_settlements_scope_created
  ON affiliate_settlements(organization_id, line_account_id, affiliate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS affiliate_settlement_lines (
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES affiliate_settlements(id),
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  entry_id TEXT REFERENCES affiliate_reward_entries(id),
  adjustment_id TEXT REFERENCES affiliate_adjustments(id),
  amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'included' CHECK (status IN ('included', 'withheld')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((entry_id IS NOT NULL AND adjustment_id IS NULL) OR (entry_id IS NULL AND adjustment_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_settlement_lines_entry
  ON affiliate_settlement_lines(entry_id) WHERE entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_settlement_lines_adjustment
  ON affiliate_settlement_lines(adjustment_id) WHERE adjustment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS affiliate_payout_batches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  settlement_id TEXT NOT NULL REFERENCES affiliate_settlements(id),
  total_amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY' CHECK (currency = 'JPY'),
  line_count INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('created', 'approved', 'exported', 'imported')),
  bank_format TEXT,
  file_checksum TEXT,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  exported_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS affiliate_payout_results (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES affiliate_payout_batches(id),
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  settlement_line_id TEXT NOT NULL REFERENCES affiliate_settlement_lines(id),
  paid_amount_minor INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('paid', 'failed', 'returned')),
  external_reference TEXT,
  imported_by TEXT NOT NULL,
  paid_at TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS affiliate_statements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  settlement_id TEXT NOT NULL REFERENCES affiliate_settlements(id),
  total_amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('generated', 'expired', 'revoked')),
  version INTEGER NOT NULL DEFAULT 1,
  pdf_object_key TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
