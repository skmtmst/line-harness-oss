-- V6 友だち追加時配信: 追加・再追加ごとの事実と「今回のリンク」を分離して保存する。
-- friends.ref_code は従来どおり初回流入のまま上書きしない。
CREATE TABLE IF NOT EXISTS friend_add_attribution_candidates (
  id                   TEXT PRIMARY KEY,
  line_account_id      TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id            TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  ref_code             TEXT NOT NULL,
  entry_route_id       TEXT REFERENCES entry_routes(id) ON DELETE SET NULL,
  source               TEXT NOT NULL CHECK (source IN ('line_login', 'liff', 'short_link')),
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'consumed', 'expired', 'late')),
  occurred_at          TEXT NOT NULL,
  consumed_by_event_id TEXT,
  expires_at           TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_friend_add_candidates_match
  ON friend_add_attribution_candidates(line_account_id, friend_id, status, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_friend_add_candidates_expiry
  ON friend_add_attribution_candidates(status, expires_at);

CREATE TABLE IF NOT EXISTS friend_add_events (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id             TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  webhook_event_id      TEXT NOT NULL,
  friend_kind           TEXT NOT NULL CHECK (friend_kind IN ('first_time', 'returning')),
  is_unblocked_hint     INTEGER CHECK (is_unblocked_hint IS NULL OR is_unblocked_hint IN (0, 1)),
  attribution_status    TEXT NOT NULL DEFAULT 'unavailable'
                          CHECK (attribution_status IN ('captured', 'unavailable')),
  ref_code              TEXT,
  entry_route_id        TEXT REFERENCES entry_routes(id) ON DELETE SET NULL,
  candidate_id          TEXT REFERENCES friend_add_attribution_candidates(id) ON DELETE SET NULL,
  routing_rule_id       TEXT,
  routing_status        TEXT NOT NULL DEFAULT 'pending'
                          CHECK (routing_status IN ('pending', 'completed', 'failed', 'suppressed')),
  occurred_at           TEXT NOT NULL,
  processed_at          TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, webhook_event_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_add_events_account_time
  ON friend_add_events(line_account_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_friend_add_events_account_state
  ON friend_add_events(line_account_id, friend_kind, attribution_status, routing_status);

CREATE INDEX IF NOT EXISTS idx_friend_add_events_friend
  ON friend_add_events(line_account_id, friend_id, occurred_at DESC);
