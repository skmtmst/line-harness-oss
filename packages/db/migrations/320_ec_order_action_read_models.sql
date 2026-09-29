-- 機能23: raw EC eventから、注文表示と個別action再試行に使う正規化台帳を分ける。

CREATE TABLE IF NOT EXISTS ec_orders (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  source_key TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  customer_id TEXT,
  friend_id TEXT REFERENCES friends(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL,
  normalized_status TEXT NOT NULL DEFAULT 'current'
    CHECK (normalized_status IN ('current', 'refunded', 'cancelled')),
  provider_status TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY',
  total_amount_minor INTEGER,
  refunded_amount_minor INTEGER,
  ordered_at TEXT NOT NULL,
  detail_url TEXT,
  last_event_id TEXT NOT NULL REFERENCES ec_events(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (line_account_id, source_key, external_order_id)
);

CREATE INDEX IF NOT EXISTS idx_ec_orders_account_ordered
  ON ec_orders(line_account_id, ordered_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ec_orders_customer
  ON ec_orders(line_account_id, customer_id, ordered_at DESC);

CREATE TABLE IF NOT EXISTS ec_order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES ec_orders(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL CHECK (line_index >= 0),
  external_product_id TEXT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_amount_minor INTEGER,
  line_amount_minor INTEGER,
  product_url TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (order_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_ec_order_lines_order
  ON ec_order_lines(order_id, line_index);

CREATE TABLE IF NOT EXISTS ec_action_executions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES ec_events(id) ON DELETE RESTRICT,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'skipped', 'retryable_failed', 'permanent_failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  error_code TEXT,
  error_message_safe TEXT,
  last_attempted_at TEXT,
  next_retry_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_id, action_type, rule_version)
);

CREATE INDEX IF NOT EXISTS idx_ec_action_executions_account_status
  ON ec_action_executions(line_account_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ec_action_executions_event
  ON ec_action_executions(event_id, created_at);

CREATE TABLE IF NOT EXISTS ec_action_execution_attempts (
  id TEXT PRIMARY KEY,
  action_execution_id TEXT NOT NULL REFERENCES ec_action_executions(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('automatic', 'manual')),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  requested_by TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  error_code TEXT,
  error_message_safe TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (action_execution_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_ec_action_attempts_execution
  ON ec_action_execution_attempts(action_execution_id, attempt_number DESC);

-- 既存eventも画面と再試行台帳へ出す。同じ注文番号では最新eventを採用する。
INSERT OR IGNORE INTO ec_orders (
  id, line_account_id, source_key, external_order_id, customer_id, friend_id,
  order_number, normalized_status, provider_status, currency, total_amount_minor,
  refunded_amount_minor, ordered_at, detail_url, last_event_id, version, created_at, updated_at
)
SELECT
  'backfill-order:' || ranked.id,
  ranked.line_account_id,
  ranked.source,
  ranked.order_number,
  ranked.customer_id,
  ranked.friend_id,
  ranked.order_number,
  CASE ranked.event_type
    WHEN 'ec.order.refunded' THEN 'refunded'
    WHEN 'ec.order.cancelled' THEN 'cancelled'
    ELSE 'current'
  END,
  ranked.event_type,
  COALESCE(json_extract(ranked.payload, '$.order.currency'), 'JPY'),
  CAST(json_extract(ranked.payload, '$.order.total') AS INTEGER),
  CAST(json_extract(ranked.payload, '$.refund.amount') AS INTEGER),
  COALESCE(json_extract(ranked.payload, '$.order.date'), json_extract(ranked.payload, '$.occurred_at'), ranked.received_at),
  json_extract(ranked.payload, '$.order.detail_url'),
  ranked.id,
  1,
  ranked.received_at,
  ranked.updated_at
FROM (
  SELECT e.*,
         json_extract(e.payload, '$.order.number') AS order_number,
         ROW_NUMBER() OVER (
           PARTITION BY e.line_account_id, e.source, json_extract(e.payload, '$.order.number')
           ORDER BY e.received_at DESC, e.id DESC
         ) AS row_rank
    FROM ec_events e
   WHERE e.line_account_id IS NOT NULL
     AND json_type(e.payload, '$.order.number') = 'text'
) ranked
WHERE ranked.row_rank = 1;

INSERT OR IGNORE INTO ec_order_lines (
  id, order_id, line_index, external_product_id, product_name, quantity,
  unit_amount_minor, line_amount_minor, product_url, created_at
)
SELECT
  'backfill-line:' || e.id || ':' || item.key,
  o.id,
  CAST(item.key AS INTEGER),
  CAST(json_extract(item.value, '$.product_id') AS TEXT),
  COALESCE(json_extract(item.value, '$.name'), '商品'),
  MAX(1, CAST(COALESCE(json_extract(item.value, '$.quantity'), 1) AS INTEGER)),
  CAST(json_extract(item.value, '$.unit_amount') AS INTEGER),
  CAST(json_extract(item.value, '$.line_amount') AS INTEGER),
  json_extract(item.value, '$.product_url'),
  e.received_at
FROM ec_events e
JOIN ec_orders o ON o.last_event_id = e.id
JOIN json_each(e.payload, '$.order.items') item
WHERE json_type(e.payload, '$.order.items') = 'array';

INSERT OR IGNORE INTO ec_action_executions (
  id, event_id, line_account_id, action_type, rule_version, idempotency_key,
  status, attempt_count, max_attempts, error_code, error_message_safe,
  last_attempted_at, version, created_at, updated_at
)
SELECT
  'backfill-action:' || id,
  id,
  line_account_id,
  CASE
    WHEN event_type = 'ec.customer.profile_updated' THEN 'profile_sync'
    WHEN event_type = 'ec.order.refunded' THEN 'conversion_mileage_adjustment'
    ELSE 'line_notification'
  END,
  'ec-action-v1',
  'ec:event:' || id || ':v1',
  CASE status
    WHEN 'processed' THEN 'succeeded'
    WHEN 'skipped' THEN 'skipped'
    WHEN 'identity_pending' THEN 'skipped'
    WHEN 'failed' THEN 'retryable_failed'
    WHEN 'processing' THEN 'processing'
    ELSE 'pending'
  END,
  CASE WHEN status IN ('processed', 'skipped', 'failed') THEN 1 ELSE 0 END,
  3,
  CASE
    WHEN status = 'failed' THEN 'legacy_processing_failed'
    WHEN status = 'identity_pending' THEN 'line_identity_unmatched'
    ELSE NULL
  END,
  CASE
    WHEN status = 'failed' THEN 'ECの処理を完了できませんでした'
    WHEN status = 'identity_pending' THEN 'LINEの友だちが見つかりません'
    ELSE NULL
  END,
  processed_at,
  1,
  received_at,
  updated_at
FROM ec_events
WHERE line_account_id IS NOT NULL;

INSERT OR IGNORE INTO ec_action_execution_attempts (
  id, action_execution_id, attempt_number, trigger_kind, from_status, to_status,
  requested_by, idempotency_key, request_fingerprint, error_code, error_message_safe, created_at
)
SELECT
  'backfill-attempt:' || id,
  'backfill-action:' || id,
  1,
  'automatic',
  'pending',
  CASE status
    WHEN 'processed' THEN 'succeeded'
    WHEN 'skipped' THEN 'skipped'
    WHEN 'failed' THEN 'retryable_failed'
    ELSE 'skipped'
  END,
  NULL,
  'automatic:backfill-action:' || id || ':1',
  'automatic:backfill-action:' || id || ':1',
  CASE WHEN status = 'failed' THEN 'legacy_processing_failed' ELSE NULL END,
  CASE WHEN status = 'failed' THEN 'ECの処理を完了できませんでした' ELSE NULL END,
  COALESCE(processed_at, updated_at)
FROM ec_events
WHERE line_account_id IS NOT NULL
  AND status IN ('processed', 'skipped', 'failed');
