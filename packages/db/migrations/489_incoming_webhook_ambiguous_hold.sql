-- migration-policy: table-rebuild
-- S (#939 機能26): 照合で「同じ値の友だちが2人以上いた」届物を保留できるようにする。
--
-- 今までの箱は「見つからなかった(unmatched)」と「友だち候補(candidate)」の
-- 2種類だけだった。複数一致は action を自動実行せず箱へ保留し、人が
-- どの友だちか選ぶ。候補の友だちIDを candidate_friend_ids_json に残す。
-- kind の CHECK を変えるため表を作り直す(既存行はそのまま引き継ぐ)。

CREATE TABLE incoming_webhook_unmatched_events_new (
  id                    TEXT PRIMARY KEY,
  webhook_id            TEXT NOT NULL REFERENCES incoming_webhooks(id),
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id),
  source_event_id       TEXT NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('unmatched', 'candidate', 'ambiguous')),
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'resolved', 'dismissed')),
  identity_attempts_json TEXT NOT NULL DEFAULT '[]'
                        CHECK (json_valid(identity_attempts_json)),
  masked_shape_json     TEXT CHECK (masked_shape_json IS NULL OR json_valid(masked_shape_json)),
  -- kind='ambiguous' の届物だけが持つ、一致した友だちIDの並び。
  candidate_friend_ids_json TEXT CHECK (candidate_friend_ids_json IS NULL OR json_valid(candidate_friend_ids_json)),
  resolved_friend_id    TEXT REFERENCES friends(id),
  resolved_by           TEXT,
  resolved_at           TEXT,
  received_at           TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (webhook_id, source_event_id)
);

INSERT INTO incoming_webhook_unmatched_events_new (
  id, webhook_id, line_account_id, source_event_id, kind, status,
  identity_attempts_json, masked_shape_json, candidate_friend_ids_json,
  resolved_friend_id, resolved_by, resolved_at, received_at, created_at, updated_at
)
SELECT
  id, webhook_id, line_account_id, source_event_id, kind, status,
  identity_attempts_json, masked_shape_json, NULL,
  resolved_friend_id, resolved_by, resolved_at, received_at, created_at, updated_at
FROM incoming_webhook_unmatched_events;

DROP TABLE incoming_webhook_unmatched_events;
ALTER TABLE incoming_webhook_unmatched_events_new RENAME TO incoming_webhook_unmatched_events;

CREATE INDEX idx_incoming_webhook_unmatched_account_status
  ON incoming_webhook_unmatched_events (line_account_id, status, received_at);
