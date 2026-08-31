-- 採用写真の公開状態と掲載先を、審査結果・原画像とは分けて記録する。
-- 既存の採用写真は自動公開しない。同意と公開用画像を確認したものだけを
-- 別工程でこの台帳へ登録する。
CREATE TABLE nen_photo_publications (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL UNIQUE REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'withdrawn')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  public_asset_kind TEXT CHECK (public_asset_kind IS NULL OR public_asset_kind = 'public_derivative'),
  public_asset_url TEXT,
  public_asset_version TEXT,
  published_by TEXT NOT NULL,
  published_by_name TEXT NOT NULL,
  published_at TEXT NOT NULL,
  withdrawn_by TEXT,
  withdrawn_by_name TEXT,
  withdrawn_reason TEXT,
  withdrawn_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, line_account_id),
  CHECK (
    (status = 'published' AND withdrawn_at IS NULL)
    OR (status = 'withdrawn' AND withdrawn_at IS NOT NULL)
  ),
  CHECK (
    (public_asset_kind IS NULL AND public_asset_url IS NULL AND public_asset_version IS NULL)
    OR (public_asset_kind = 'public_derivative' AND public_asset_url IS NOT NULL
        AND public_asset_version IS NOT NULL)
  )
);

CREATE TABLE nen_photo_publication_placements (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  placement_type TEXT NOT NULL
    CHECK (placement_type IN ('rich_menu', 'nen_column', 'form', 'website')),
  placement_key TEXT NOT NULL,
  placement_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'removing', 'removed', 'failed')),
  display_count INTEGER CHECK (display_count IS NULL OR display_count >= 0),
  display_count_source TEXT,
  display_count_updated_at TEXT,
  placed_at TEXT NOT NULL,
  removed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(publication_id, line_account_id)
    REFERENCES nen_photo_publications(id, line_account_id) ON DELETE CASCADE,
  UNIQUE(publication_id, placement_type, placement_key),
  CHECK (status != 'removed' OR removed_at IS NOT NULL)
);

CREATE INDEX idx_nen_photo_publications_account_status
  ON nen_photo_publications(line_account_id, status, published_at DESC);
CREATE INDEX idx_nen_photo_placements_account_status
  ON nen_photo_publication_placements(line_account_id, status, placement_type);
