-- 友だち同士とEC会員照合で共有する「同じ人かを根拠から判断する」台帳。
-- 判断で元レコードを削除せず、候補・根拠・履歴・解除を残す。
CREATE TABLE IF NOT EXISTS identity_candidates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('friend_duplicate', 'ec_member')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'linked', 'different', 'deferred', 'invalidated')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  detector_version TEXT NOT NULL,
  left_subject_kind TEXT NOT NULL CHECK (left_subject_kind IN ('friend', 'ec_event')),
  left_subject_id TEXT NOT NULL,
  left_line_account_id TEXT REFERENCES line_accounts(id) ON DELETE RESTRICT,
  left_shop_key TEXT,
  left_snapshot_json TEXT NOT NULL CHECK (json_valid(left_snapshot_json)),
  right_subject_kind TEXT NOT NULL CHECK (right_subject_kind = 'friend'),
  right_subject_id TEXT NOT NULL REFERENCES friends(id) ON DELETE RESTRICT,
  right_line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  right_shop_key TEXT,
  right_snapshot_json TEXT NOT NULL CHECK (json_valid(right_snapshot_json)),
  source_key TEXT,
  external_customer_id TEXT,
  evidence_fingerprint TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  impact_json TEXT NOT NULL CHECK (json_valid(impact_json)),
  detected_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (kind = 'friend_duplicate' AND left_subject_kind = 'friend'
      AND left_line_account_id IS NOT NULL AND left_subject_id < right_subject_id)
    OR
    (kind = 'ec_member' AND left_subject_kind = 'ec_event'
      AND left_line_account_id = right_line_account_id
      AND left_shop_key IS NOT NULL AND source_key IS NOT NULL
      AND external_customer_id IS NOT NULL)
  ),
  UNIQUE (
    tenant_id, kind, left_subject_kind, left_subject_id,
    right_subject_kind, right_subject_id
  )
);

CREATE INDEX IF NOT EXISTS idx_identity_candidates_review_queue
  ON identity_candidates(tenant_id, kind, status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_candidates_left_account
  ON identity_candidates(tenant_id, left_line_account_id, status);
CREATE INDEX IF NOT EXISTS idx_identity_candidates_right_account
  ON identity_candidates(tenant_id, right_line_account_id, status);

-- 追記専用の判断履歴。candidate_versionで同じ版への二重判断を防ぐ。
CREATE TABLE IF NOT EXISTS identity_candidate_decisions (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES identity_candidates(id) ON DELETE RESTRICT,
  candidate_version INTEGER NOT NULL CHECK (candidate_version >= 2),
  from_status TEXT NOT NULL
    CHECK (from_status IN ('pending', 'linked', 'different', 'deferred', 'invalidated')),
  to_status TEXT NOT NULL
    CHECK (to_status IN ('pending', 'linked', 'different', 'deferred', 'invalidated')),
  actor_staff_id TEXT,
  actor_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  impact_snapshot_json TEXT NOT NULL CHECK (json_valid(impact_snapshot_json)),
  reprocess_scope_json TEXT CHECK (reprocess_scope_json IS NULL OR json_valid(reprocess_scope_json)),
  decided_at TEXT NOT NULL,
  UNIQUE(candidate_id, candidate_version)
);

CREATE INDEX IF NOT EXISTS idx_identity_candidate_decisions_history
  ON identity_candidate_decisions(candidate_id, decided_at DESC);

-- 友だちの元行を残したままusersへ結ぶ。解除しても行を削除しない。
CREATE TABLE IF NOT EXISTS friend_identity_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id TEXT NOT NULL REFERENCES identity_candidates(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE RESTRICT,
  link_method TEXT NOT NULL,
  evidence_snapshot_json TEXT NOT NULL CHECK (json_valid(evidence_snapshot_json)),
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  linked_by TEXT,
  linked_at TEXT NOT NULL,
  unlinked_by TEXT,
  unlinked_at TEXT,
  unlink_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_identity_links_active_friend
  ON friend_identity_links(friend_id) WHERE unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_friend_identity_links_user
  ON friend_identity_links(tenant_id, user_id, linked_at DESC);

-- EC側の確定済み外部会員リンク。shop/accountを跨いだ暗黙照合を許さない。
CREATE TABLE IF NOT EXISTS ec_identity_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id TEXT NOT NULL REFERENCES identity_candidates(id) ON DELETE RESTRICT,
  source_key TEXT NOT NULL,
  shop_key TEXT NOT NULL,
  external_customer_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE RESTRICT,
  linked_by TEXT,
  linked_at TEXT NOT NULL,
  unlinked_by TEXT,
  unlinked_at TEXT,
  unlink_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ec_identity_links_active_customer
  ON ec_identity_links(tenant_id, source_key, shop_key, external_customer_id)
  WHERE unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ec_identity_links_friend
  ON ec_identity_links(tenant_id, line_account_id, friend_id, linked_at DESC);
