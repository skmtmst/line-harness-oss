-- デリバリー連携のうち Uber Eats の「お店が自分でログインしてつなぐ」経路の保存先。
-- 設計の根拠は docs/integrations/uber-eats-connection.md（公式仕様の要点は同5節）。
-- 時刻は 635_restaurant_delivery_orders.sql と同じくミリ秒の整数で持つ。
-- 鍵・トークンは packages/db/src/credential-crypto.ts で暗号化した形式（v1.…）だけを保存する。
-- Uber は更新用トークンを返さない（refresh_token は空文字）ため、更新用の欄は作らない。
-- 切れる前に取り直す方式にする。

-- 認可中の一時状態。Cookie の state と突き合わせ、1回使い切り・10分で失効。
CREATE TABLE IF NOT EXISTS rt_delivery_uber_oauth_states (
  state TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('connect', 'reconnect')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rt_delivery_uber_oauth_states_expires
  ON rt_delivery_uber_oauth_states(expires_at);

-- 店舗ごとの Uber 接続。1店舗につき1件。
-- access_token_enc は店舗の認可で得た利用者トークン（権限 eats.pos_provisioning）。
-- 日々の運用に使うアプリ単位のトークンは下の rt_delivery_uber_app_tokens に持つ。
CREATE TABLE IF NOT EXISTS rt_delivery_uber_connections (
  store_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  -- Uber 側の店舗ID。これが照合の正。外部店舗IDは変わりうるので単独の照合キーにしない。
  uber_store_id TEXT,
  uber_store_name TEXT,
  external_store_id TEXT,
  access_token_enc TEXT,
  access_token_expires_at INTEGER,
  -- 許された権限を空白区切りで記録する。要求と違う権限が返ったときの切り分けに使う。
  granted_scope TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('pending_store', 'connected', 'expired', 'no_permission', 'disconnected')),
  connected_by_staff_id TEXT,
  connected_at INTEGER,
  disconnected_at INTEGER,
  -- POST /pos_data が通った時刻。ここが入って初めて Uber 側で連携が有効。
  provisioned_at INTEGER,
  last_error TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rt_delivery_uber_connections_status
  ON rt_delivery_uber_connections(status, access_token_expires_at);

-- ログイン直後に出す「つなぐ店舗を選ぶ」の候補（設計 DL-4）。選び終わったら消す。
CREATE TABLE IF NOT EXISTS rt_delivery_uber_store_candidates (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  uber_store_id TEXT NOT NULL,
  uber_store_name TEXT NOT NULL,
  external_store_id TEXT,
  address_text TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (store_id, uber_store_id)
);

-- アプリ単位のトークン（client_credentials）の控え。店舗ごとではない。
-- トークンの口は1時間100回までで、取り直すと古いトークンが無効になるため、
-- 取得のたびに取り直さず、ここから使い回して期限が近いときだけ取り直す。
CREATE TABLE IF NOT EXISTS rt_delivery_uber_app_tokens (
  id TEXT PRIMARY KEY,
  access_token_enc TEXT NOT NULL,
  access_token_expires_at INTEGER NOT NULL,
  granted_scope TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
