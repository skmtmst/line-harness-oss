-- V6 マイルの使い道・交換基盤。
-- 273はPR #743、274はPR #759が使用中のため、次の275を採番する。
--
-- 既存の mileage_ledger を正本として残し、公開版・交換要求・コード在庫を
-- 追加する。公開済みの版と交換履歴は後から書き換えない。

CREATE TABLE IF NOT EXISTS mileage_rewards (
  id                           TEXT PRIMARY KEY,
  line_account_id              TEXT NOT NULL REFERENCES line_accounts(id),
  program_id                   TEXT NOT NULL DEFAULT 'default' REFERENCES mileage_programs(id),
  name                         TEXT NOT NULL,
  description                  TEXT,
  image_url                    TEXT,
  reward_kind                  TEXT NOT NULL
                                 CHECK (reward_kind IN (
                                   'coupon', 'tag', 'scenario', 'template',
                                   'early_access', 'rank'
                                 )),
  status                       TEXT NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'published', 'stopped', 'archived')),
  sort_order                   INTEGER NOT NULL DEFAULT 0,
  current_draft_version_id     TEXT REFERENCES mileage_reward_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  current_published_version_id TEXT REFERENCES mileage_reward_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  created_by                   TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_mileage_rewards_account_status
  ON mileage_rewards(line_account_id, status, sort_order, updated_at DESC);

CREATE TABLE IF NOT EXISTS mileage_reward_versions (
  id                       TEXT PRIMARY KEY,
  reward_id                TEXT NOT NULL REFERENCES mileage_rewards(id),
  version_number           INTEGER NOT NULL CHECK (version_number > 0),
  status                   TEXT NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'published')),
  required_miles           INTEGER NOT NULL CHECK (required_miles > 0),
  stock_limit              INTEGER CHECK (stock_limit IS NULL OR stock_limit >= 0),
  per_friend_limit         INTEGER CHECK (per_friend_limit IS NULL OR per_friend_limit > 0),
  starts_at                TEXT,
  ends_at                  TEXT,
  benefit_expires_days     INTEGER CHECK (benefit_expires_days IS NULL OR benefit_expires_days > 0),
  common_action_version_id TEXT REFERENCES common_action_versions(id),
  failure_policy           TEXT NOT NULL DEFAULT 'retry'
                             CHECK (failure_policy IN ('retry', 'refund', 'manual')),
  customer_message         TEXT NOT NULL DEFAULT '',
  created_by               TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  published_at             TEXT,
  UNIQUE (reward_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_mileage_reward_versions_reward_status
  ON mileage_reward_versions(reward_id, status, version_number DESC);

CREATE TRIGGER IF NOT EXISTS trg_mileage_reward_published_version_immutable
BEFORE UPDATE ON mileage_reward_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published mileage reward version is immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_mileage_reward_published_version_no_delete
BEFORE DELETE ON mileage_reward_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published mileage reward version cannot be deleted'); END;

CREATE TABLE IF NOT EXISTS mileage_wallets (
  program_id            TEXT NOT NULL REFERENCES mileage_programs(id),
  beneficiary_key       TEXT NOT NULL,
  beneficiary_user_id   TEXT REFERENCES users(id),
  beneficiary_friend_id TEXT REFERENCES friends(id),
  available             INTEGER NOT NULL DEFAULT 0,
  pending               INTEGER NOT NULL DEFAULT 0,
  version               INTEGER NOT NULL DEFAULT 0,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (program_id, beneficiary_key)
);

INSERT OR IGNORE INTO mileage_wallets
  (program_id, beneficiary_key, beneficiary_user_id, beneficiary_friend_id,
   available, pending, version, updated_at)
SELECT ml.program_id,
       CASE
         WHEN COALESCE(ml.beneficiary_user_id, f.user_id) IS NOT NULL
           THEN 'user:' || COALESCE(ml.beneficiary_user_id, f.user_id)
         ELSE 'friend:' || ml.beneficiary_friend_id
       END,
       COALESCE(ml.beneficiary_user_id, f.user_id),
       CASE WHEN COALESCE(ml.beneficiary_user_id, f.user_id) IS NULL
            THEN ml.beneficiary_friend_id ELSE NULL END,
       SUM(CASE WHEN ml.status = 'available' THEN ml.amount ELSE 0 END),
       SUM(CASE WHEN ml.status = 'pending' THEN ml.amount ELSE 0 END),
       1,
       datetime('now')
  FROM mileage_ledger ml
  LEFT JOIN friends f ON f.id = ml.beneficiary_friend_id
 WHERE ml.beneficiary_friend_id IS NOT NULL OR ml.beneficiary_user_id IS NOT NULL
 GROUP BY ml.program_id,
          CASE
            WHEN COALESCE(ml.beneficiary_user_id, f.user_id) IS NOT NULL
              THEN 'user:' || COALESCE(ml.beneficiary_user_id, f.user_id)
            ELSE 'friend:' || ml.beneficiary_friend_id
          END;

CREATE TRIGGER IF NOT EXISTS trg_mileage_wallet_after_ledger_insert
AFTER INSERT ON mileage_ledger
WHEN NEW.beneficiary_friend_id IS NOT NULL OR NEW.beneficiary_user_id IS NOT NULL
BEGIN
  INSERT INTO mileage_wallets
    (program_id, beneficiary_key, beneficiary_user_id, beneficiary_friend_id,
     available, pending, version, updated_at)
  SELECT NEW.program_id,
         CASE
           WHEN COALESCE(NEW.beneficiary_user_id, f.user_id) IS NOT NULL
             THEN 'user:' || COALESCE(NEW.beneficiary_user_id, f.user_id)
           ELSE 'friend:' || NEW.beneficiary_friend_id
         END,
         COALESCE(NEW.beneficiary_user_id, f.user_id),
         CASE WHEN COALESCE(NEW.beneficiary_user_id, f.user_id) IS NULL
              THEN NEW.beneficiary_friend_id ELSE NULL END,
         CASE WHEN NEW.status = 'available' THEN NEW.amount ELSE 0 END,
         CASE WHEN NEW.status = 'pending' THEN NEW.amount ELSE 0 END,
         1,
         NEW.created_at
    FROM (SELECT 1) seed
    LEFT JOIN friends f ON f.id = NEW.beneficiary_friend_id
  ON CONFLICT(program_id, beneficiary_key) DO UPDATE SET
    available = mileage_wallets.available + excluded.available,
    pending = mileage_wallets.pending + excluded.pending,
    version = mileage_wallets.version + 1,
    updated_at = excluded.updated_at; END;

CREATE TABLE IF NOT EXISTS mileage_grant_lots (
  ledger_entry_id       TEXT PRIMARY KEY REFERENCES mileage_ledger(id),
  program_id            TEXT NOT NULL REFERENCES mileage_programs(id),
  beneficiary_key       TEXT NOT NULL,
  original_amount       INTEGER NOT NULL CHECK (original_amount > 0),
  remaining_amount      INTEGER NOT NULL CHECK (remaining_amount >= 0),
  available_at          TEXT NOT NULL,
  expires_at            TEXT,
  status                TEXT NOT NULL DEFAULT 'available'
                          CHECK (status IN ('available', 'exhausted', 'expired', 'void')),
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mileage_grant_lots_spend_order
  ON mileage_grant_lots(program_id, beneficiary_key, status, expires_at, available_at);

INSERT OR IGNORE INTO mileage_grant_lots
  (ledger_entry_id, program_id, beneficiary_key, original_amount, remaining_amount,
   available_at, expires_at, status, created_at)
SELECT ml.id,
       ml.program_id,
       CASE
         WHEN COALESCE(ml.beneficiary_user_id, f.user_id) IS NOT NULL
           THEN 'user:' || COALESCE(ml.beneficiary_user_id, f.user_id)
         ELSE 'friend:' || ml.beneficiary_friend_id
       END,
       ml.amount,
       ml.amount,
       ml.occurred_at,
       json_extract(ml.metadata, '$.expiresAt'),
       'available',
       ml.created_at
  FROM mileage_ledger ml
  LEFT JOIN friends f ON f.id = ml.beneficiary_friend_id
 WHERE ml.amount > 0
   AND ml.status = 'available'
   AND ml.entry_type IN ('grant', 'adjustment');

CREATE TRIGGER IF NOT EXISTS trg_mileage_grant_lot_after_ledger_insert
AFTER INSERT ON mileage_ledger
WHEN NEW.amount > 0
 AND NEW.status = 'available'
 AND NEW.entry_type IN ('grant', 'adjustment')
BEGIN
  INSERT OR IGNORE INTO mileage_grant_lots
    (ledger_entry_id, program_id, beneficiary_key, original_amount, remaining_amount,
     available_at, expires_at, status, created_at)
  SELECT NEW.id,
         NEW.program_id,
         CASE
           WHEN COALESCE(NEW.beneficiary_user_id, f.user_id) IS NOT NULL
             THEN 'user:' || COALESCE(NEW.beneficiary_user_id, f.user_id)
           ELSE 'friend:' || NEW.beneficiary_friend_id
         END,
         NEW.amount,
         NEW.amount,
         NEW.occurred_at,
         json_extract(NEW.metadata, '$.expiresAt'),
         'available',
         NEW.created_at
    FROM (SELECT 1) seed
    LEFT JOIN friends f ON f.id = NEW.beneficiary_friend_id; END;

CREATE TABLE IF NOT EXISTS mileage_redemptions (
  id                       TEXT PRIMARY KEY,
  line_account_id          TEXT NOT NULL REFERENCES line_accounts(id),
  program_id               TEXT NOT NULL REFERENCES mileage_programs(id),
  beneficiary_key          TEXT NOT NULL,
  beneficiary_user_id      TEXT REFERENCES users(id),
  beneficiary_friend_id    TEXT REFERENCES friends(id),
  reward_id                TEXT NOT NULL REFERENCES mileage_rewards(id),
  reward_version_id        TEXT NOT NULL REFERENCES mileage_reward_versions(id),
  spend_ledger_entry_id    TEXT REFERENCES mileage_ledger(id),
  reward_code_id           TEXT,
  idempotency_key          TEXT NOT NULL,
  request_fingerprint      TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'reserved'
                             CHECK (status IN (
                               'reserved', 'delivering', 'succeeded',
                               'delivery_failed', 'refunded'
                             )),
  attempt_count            INTEGER NOT NULL DEFAULT 0,
  next_retry_at            TEXT,
  failure_code             TEXT,
  failure_message          TEXT,
  delivered_at             TEXT,
  refunded_at              TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (program_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_mileage_redemptions_reward_created
  ON mileage_redemptions(reward_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mileage_redemptions_friend_created
  ON mileage_redemptions(beneficiary_friend_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mileage_redemptions_retry
  ON mileage_redemptions(status, next_retry_at)
  WHERE status = 'delivery_failed';

CREATE TRIGGER IF NOT EXISTS trg_mileage_redemptions_no_delete
BEFORE DELETE ON mileage_redemptions
BEGIN SELECT RAISE(ABORT, 'mileage redemption history cannot be deleted'); END;

CREATE TABLE IF NOT EXISTS mileage_spend_allocations (
  id                TEXT PRIMARY KEY,
  redemption_id     TEXT NOT NULL REFERENCES mileage_redemptions(id),
  spend_ledger_id   TEXT NOT NULL REFERENCES mileage_ledger(id),
  grant_lot_id      TEXT NOT NULL REFERENCES mileage_grant_lots(ledger_entry_id),
  amount            INTEGER NOT NULL CHECK (amount > 0),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (redemption_id, grant_lot_id)
);

CREATE INDEX IF NOT EXISTS idx_mileage_spend_allocations_grant
  ON mileage_spend_allocations(grant_lot_id);

CREATE TABLE IF NOT EXISTS mileage_reward_codes (
  id                 TEXT PRIMARY KEY,
  reward_version_id  TEXT NOT NULL REFERENCES mileage_reward_versions(id),
  code_ciphertext    TEXT NOT NULL,
  code_fingerprint   TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'available'
                       CHECK (status IN ('available', 'reserved', 'issued', 'void')),
  redemption_id      TEXT UNIQUE REFERENCES mileage_redemptions(id),
  reserved_at        TEXT,
  issued_at          TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (reward_version_id, code_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_mileage_reward_codes_available
  ON mileage_reward_codes(reward_version_id, status, created_at);

CREATE TABLE IF NOT EXISTS mileage_redemption_attempts (
  id              TEXT PRIMARY KEY,
  redemption_id   TEXT NOT NULL REFERENCES mileage_redemptions(id),
  attempt_number  INTEGER NOT NULL CHECK (attempt_number > 0),
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'succeeded', 'failed')),
  error_code      TEXT,
  error_message   TEXT,
  started_at      TEXT NOT NULL,
  completed_at    TEXT,
  UNIQUE (redemption_id, attempt_number)
);

CREATE TRIGGER IF NOT EXISTS trg_mileage_redemption_attempts_no_delete
BEFORE DELETE ON mileage_redemption_attempts
BEGIN SELECT RAISE(ABORT, 'mileage redemption attempt history cannot be deleted'); END;
