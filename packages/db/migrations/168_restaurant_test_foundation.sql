-- 飲食店向け（テスト）の専用データ領域。
-- 既存のLINE/EC機能と混在させず、将来別サーバーへ切り出せるよう rt_ 接頭辞で統一する。
-- 外部予約媒体は検証段階では inbound_only / disabled だけを許可し、外向き更新を持たない。

CREATE TABLE IF NOT EXISTS rt_organizations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'test' CHECK (status IN ('test', 'active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rt_organizations_account ON rt_organizations(account_id);

CREATE TABLE IF NOT EXISTS rt_stores (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES rt_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  area TEXT,
  capacity INTEGER NOT NULL DEFAULT 24 CHECK (capacity >= 0),
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  line_status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (line_status IN ('connected', 'warning', 'error', 'unconfigured')),
  google_status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (google_status IN ('connected', 'warning', 'error', 'unconfigured')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_rt_stores_org ON rt_stores(organization_id, status);

CREATE TABLE IF NOT EXISTS rt_memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES rt_organizations(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES rt_stores(id) ON DELETE CASCADE,
  staff_name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'store_manager', 'staff')),
  line_uid TEXT,
  google_email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rt_memberships_org ON rt_memberships(organization_id, store_id, role);

CREATE TABLE IF NOT EXISTS rt_approval_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES rt_organizations(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES rt_stores(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('gbp_post', 'line_message', 'menu_change')),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'scheduled', 'completed', 'returned')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  requested_by TEXT,
  reviewed_by TEXT,
  review_comment TEXT,
  scheduled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rt_approvals_queue ON rt_approval_requests(organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS rt_tables (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  seat_type TEXT NOT NULL CHECK (seat_type IN ('counter', 'table', 'private_room', 'terrace')),
  min_capacity INTEGER NOT NULL DEFAULT 1 CHECK (min_capacity > 0),
  max_capacity INTEGER NOT NULL CHECK (max_capacity >= min_capacity),
  floor_x INTEGER NOT NULL DEFAULT 0,
  floor_y INTEGER NOT NULL DEFAULT 0,
  join_group TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, code)
);
CREATE INDEX IF NOT EXISTS idx_rt_tables_store ON rt_tables(store_id, is_active);

CREATE TABLE IF NOT EXISTS rt_menu_items (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('course', 'a_la_carte')),
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  tax_mode TEXT NOT NULL DEFAULT 'tax_included' CHECK (tax_mode IN ('tax_included', 'tax_excluded')),
  allergens_json TEXT NOT NULL DEFAULT '[]',
  service_periods_json TEXT NOT NULL DEFAULT '["dinner"]',
  duration_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rt_menu_store ON rt_menu_items(store_id, status, kind);

CREATE TABLE IF NOT EXISTS rt_reservations (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('restaurant_board', 'reszaiko', 'hotpepper', 'tabelog', 'gurunavi', 'ikyu', 'retty', 'line', 'phone', 'manual')),
  external_id TEXT,
  hub_source TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  line_uid TEXT,
  guest_count INTEGER NOT NULL CHECK (guest_count > 0),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  table_id TEXT REFERENCES rt_tables(id) ON DELETE SET NULL,
  course_id TEXT REFERENCES rt_menu_items(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'seated', 'visited', 'cancelled', 'no_show')),
  allergy_note TEXT,
  note TEXT,
  sync_direction TEXT NOT NULL DEFAULT 'inbound_only' CHECK (sync_direction = 'inbound_only'),
  source_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rt_reservations_external
  ON rt_reservations(store_id, source, external_id);
CREATE INDEX IF NOT EXISTS idx_rt_reservations_timeline ON rt_reservations(store_id, starts_at, status);

CREATE TABLE IF NOT EXISTS rt_inventory_slots (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  slot_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_minutes IN (15, 30)),
  total_capacity INTEGER NOT NULL CHECK (total_capacity >= 0),
  ota_capacity INTEGER NOT NULL DEFAULT 0 CHECK (ota_capacity >= 0),
  line_capacity INTEGER NOT NULL DEFAULT 0 CHECK (line_capacity >= 0),
  walk_in_capacity INTEGER NOT NULL DEFAULT 0 CHECK (walk_in_capacity >= 0),
  reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, starts_at)
);
CREATE INDEX IF NOT EXISTS idx_rt_inventory_store_time ON rt_inventory_slots(store_id, starts_at);

CREATE TABLE IF NOT EXISTS rt_connector_status (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('restaurant_board', 'reszaiko', 'hotpepper', 'tabelog', 'gurunavi', 'ikyu', 'retty', 'google_business_profile', 'line')),
  mode TEXT NOT NULL DEFAULT 'disabled' CHECK (mode IN ('disabled', 'inbound_only')),
  status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('connected', 'warning', 'error', 'unconfigured', 'disabled')),
  last_synced_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, provider)
);

CREATE TABLE IF NOT EXISTS rt_sync_events (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction = 'inbound'),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received', 'processed', 'duplicate', 'failed')),
  error_message TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  UNIQUE(store_id, provider, external_event_id)
);
CREATE INDEX IF NOT EXISTS idx_rt_sync_events_recent ON rt_sync_events(store_id, received_at DESC);

-- Cloudflare/D1上の検証版は短期リースで排他する。別サーバーへ切り出す際に
-- 同じ resource_key 契約のRedis実装へ差し替えられるよう、業務テーブルから分離する。
CREATE TABLE IF NOT EXISTS rt_resource_locks (
  resource_key TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rt_gbp_reviews (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  external_review_id TEXT NOT NULL,
  author_name TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  reviewed_at TEXT NOT NULL,
  reply_status TEXT NOT NULL DEFAULT 'unreplied' CHECK (reply_status IN ('unreplied', 'draft', 'approved', 'replied')),
  reply_draft TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, external_review_id)
);
CREATE INDEX IF NOT EXISTS idx_rt_gbp_reviews_store ON rt_gbp_reviews(store_id, reply_status, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS rt_gbp_posts (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  post_type TEXT NOT NULL CHECK (post_type IN ('standard', 'event', 'offer')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  media_url TEXT,
  cta_type TEXT CHECK (cta_type IN ('book', 'call', 'learn_more')),
  cta_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'scheduled', 'published')),
  scheduled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rt_line_flows (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES rt_organizations(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES rt_stores(id) ON DELETE CASCADE,
  flow_type TEXT NOT NULL CHECK (flow_type IN ('reservation_24h', 'reservation_2h', 'post_visit', 'review_request', 'member_card', 'one_tap_booking')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  timing_minutes INTEGER,
  is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
  delivery_mode TEXT NOT NULL DEFAULT 'preview_only' CHECK (delivery_mode IN ('preview_only', 'disabled')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, store_id, flow_type)
);
