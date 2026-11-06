-- 草稿：オーナーの番号承認後に司令塔が適用する。本作業ではD1に適用しない。
CREATE TABLE broadcast_media_upload_sessions (
  id TEXT PRIMARY KEY,
  line_account_id TEXT REFERENCES line_accounts(id),
  created_by TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  public_key TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  expected_size INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE coupon_redemptions (
  id TEXT PRIMARY KEY,
  -- 素材を削除しても使用履歴を残す。設定はpayload_snapshotに固定する。
  asset_id TEXT NOT NULL,
  friend_id TEXT NOT NULL REFERENCES friends(id),
  line_account_id TEXT REFERENCES line_accounts(id),
  incoming_event_id TEXT NOT NULL UNIQUE,
  used_at TEXT NOT NULL,
  use_number INTEGER NOT NULL,
  payload_snapshot TEXT NOT NULL
);
CREATE INDEX idx_coupon_redemptions_friend ON coupon_redemptions(asset_id, friend_id);
CREATE TABLE auto_reply_deliveries (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL UNIQUE REFERENCES auto_reply_evaluations(id),
  friend_id TEXT NOT NULL REFERENCES friends(id),
  line_account_id TEXT REFERENCES line_accounts(id),
  version_id TEXT NOT NULL REFERENCES auto_reply_versions(id),
  message_json TEXT NOT NULL,
  action_summary TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','accepted','failed','skipped')),
  completed_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_auto_reply_deliveries_due ON auto_reply_deliveries(status, due_at);

CREATE TABLE imagemap_images (
  id TEXT PRIMARY KEY,
  line_account_id TEXT REFERENCES line_accounts(id),
  r2_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
