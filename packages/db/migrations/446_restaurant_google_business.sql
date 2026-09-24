-- 飲食店向け「Googleビジネス」第1段（設定＋口コミ）。
-- 旧 rt_gbp_reviews / rt_gbp_posts は変更・削除しない（CHECK制約が新設計と合わないため、新しい表で置き換える）。
-- 1店舗（rt_stores）＝1 LINE公式アカウント＝1 Google ロケーション。

-- 店舗ごとのGoogle接続。トークンは packages/db/src/credential-crypto.ts で暗号化した形式（v1.…）だけを保存する。
CREATE TABLE IF NOT EXISTS rt_google_connections (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL UNIQUE REFERENCES rt_stores(id) ON DELETE CASCADE,
  line_account_id TEXT REFERENCES line_accounts(id),
  google_account_email TEXT,
  location_name TEXT,
  location_title TEXT,
  location_maps_url TEXT,
  refresh_token_enc TEXT,
  access_token_enc TEXT,
  access_token_expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('pending_location', 'connected', 'expired', 'no_permission', 'disconnected')),
  connected_by_staff_id TEXT,
  connected_at TEXT,
  disconnected_at TEXT,
  last_synced_at TEXT,
  last_sync_error TEXT,
  average_rating REAL,
  total_review_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 認可中の一時状態。Cookieのstateと突き合わせ、1回使い切り・10分で失効。
CREATE TABLE IF NOT EXISTS rt_google_oauth_states (
  state TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  line_account_id TEXT,
  staff_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('connect', 'reconnect')),
  code_verifier_enc TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rt_google_oauth_states_expires ON rt_google_oauth_states(expires_at);

-- 複数店舗を管理するGoogleアカウントで、接続直後に1店舗を選ぶまでの候補。選択後は消す。
CREATE TABLE IF NOT EXISTS rt_google_location_candidates (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  location_name TEXT NOT NULL,
  location_title TEXT NOT NULL,
  address_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, location_name)
);

-- 取得した口コミ。reviewer_display_name 以外の個人情報は保存しない。
CREATE TABLE IF NOT EXISTS rt_google_reviews (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  review_name TEXT NOT NULL,
  reviewer_display_name TEXT,
  star_rating INTEGER NOT NULL CHECK (star_rating BETWEEN 1 AND 5),
  comment TEXT,
  create_time TEXT NOT NULL,
  update_time TEXT,
  needs_attention INTEGER NOT NULL DEFAULT 0,
  reply_status TEXT NOT NULL DEFAULT 'unreplied'
    CHECK (reply_status IN ('unreplied', 'draft', 'pending_confirm', 'replied', 'published')),
  reply_draft TEXT,
  reply_draft_ai_generated INTEGER NOT NULL DEFAULT 0,
  reply_draft_generated_at TEXT,
  reply_comment TEXT,
  reply_update_time TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, review_name)
);
CREATE INDEX IF NOT EXISTS idx_rt_google_reviews_store
  ON rt_google_reviews(store_id, reply_status, create_time DESC);

-- Googleへの書き込みの記録（誰が・どの対象に・何を・結果）。
CREATE TABLE IF NOT EXISTS rt_google_write_log (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('review_reply', 'connect', 'reconnect', 'disconnect')),
  target_name TEXT,
  staff_id TEXT,
  before_text TEXT,
  after_text TEXT,
  request_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('accepted', 'failed', 'unknown')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rt_google_write_log_store ON rt_google_write_log(store_id, created_at DESC);
