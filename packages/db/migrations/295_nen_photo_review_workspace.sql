-- 写真の原本と審査・公開用画像を分け、掲載先とポイント付与待ちを追跡する。
ALTER TABLE nen_photo_submissions ADD COLUMN review_image_url TEXT;
ALTER TABLE nen_photo_submissions ADD COLUMN public_image_url TEXT;
ALTER TABLE nen_photo_submissions ADD COLUMN image_width INTEGER CHECK (image_width IS NULL OR image_width > 0);
ALTER TABLE nen_photo_submissions ADD COLUMN image_height INTEGER CHECK (image_height IS NULL OR image_height > 0);
ALTER TABLE nen_photo_submissions ADD COLUMN image_byte_size INTEGER CHECK (image_byte_size IS NULL OR image_byte_size >= 0);
ALTER TABLE nen_photo_submissions ADD COLUMN captured_device TEXT;
ALTER TABLE nen_photo_submissions ADD COLUMN review_version INTEGER NOT NULL DEFAULT 1 CHECK (review_version > 0);

CREATE TABLE nen_photo_risk_assessments (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  flag TEXT NOT NULL,
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  note TEXT,
  provider TEXT,
  model_version TEXT,
  assessed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_nen_photo_risks_photo_created
  ON nen_photo_risk_assessments(photo_id, created_at DESC);

CREATE TABLE nen_photo_publications (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL UNIQUE REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'withdrawn')),
  show_owner_name INTEGER NOT NULL DEFAULT 0 CHECK (show_owner_name IN (0, 1)),
  view_count INTEGER CHECK (view_count IS NULL OR view_count >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  last_idempotency_key TEXT,
  published_at TEXT NOT NULL,
  withdrawn_at TEXT,
  withdrawn_by TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_nen_photo_publications_account_status
  ON nen_photo_publications(line_account_id, status, published_at DESC);
CREATE UNIQUE INDEX idx_nen_photo_publications_idempotency
  ON nen_photo_publications(line_account_id, last_idempotency_key)
  WHERE last_idempotency_key IS NOT NULL;

CREATE TABLE nen_photo_publication_placements (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES nen_photo_publications(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  placement_type TEXT NOT NULL CHECK (placement_type IN ('rich_menu', 'column', 'form', 'site')),
  placement_label TEXT NOT NULL,
  view_count INTEGER CHECK (view_count IS NULL OR view_count >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  removed_at TEXT,
  UNIQUE(publication_id, placement_type, placement_label)
);
CREATE INDEX idx_nen_photo_placements_account_active
  ON nen_photo_publication_placements(line_account_id, active, created_at DESC);

CREATE TABLE nen_photo_reward_outbox (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL UNIQUE REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  provider_award_key TEXT NOT NULL UNIQUE,
  policy_version TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'synced', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  next_attempt_at TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_nen_photo_reward_outbox_pending
  ON nen_photo_reward_outbox(status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');
