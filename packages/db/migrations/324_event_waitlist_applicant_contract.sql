-- migration-policy: table-rebuild
-- V6 機能29: 複数人申込、申込時点の回答、初回参加判定、期限付きキャンセル待ち。

ALTER TABLE event_slots
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

ALTER TABLE event_bookings
  ADD COLUMN party_size INTEGER NOT NULL DEFAULT 1 CHECK (party_size >= 1);
ALTER TABLE event_bookings
  ADD COLUMN answer_snapshot_json TEXT CHECK (
    answer_snapshot_json IS NULL OR json_valid(answer_snapshot_json)
  );
ALTER TABLE event_bookings
  ADD COLUMN first_participation INTEGER CHECK (first_participation IN (0, 1));
ALTER TABLE event_bookings
  ADD COLUMN first_participation_attended_count INTEGER CHECK (
    first_participation_attended_count IS NULL OR first_participation_attended_count >= 0
  );
ALTER TABLE event_bookings
  ADD COLUMN first_participation_checked_at TEXT;

-- 既存申込も「申込時点より前の参加済み件数」で判定し、未取得の0扱いを避ける。
UPDATE event_bookings
SET first_participation = CASE WHEN EXISTS (
      SELECT 1
      FROM event_bookings AS prior
      WHERE prior.friend_id = event_bookings.friend_id
        AND prior.status = 'attended'
        AND prior.requested_at < event_bookings.requested_at
    ) THEN 0 ELSE 1 END,
    first_participation_attended_count = (
      SELECT COUNT(*)
      FROM event_bookings AS prior
      WHERE prior.friend_id = event_bookings.friend_id
        AND prior.status = 'attended'
        AND prior.requested_at < event_bookings.requested_at
    ),
    first_participation_checked_at = requested_at
WHERE first_participation IS NULL;

CREATE TABLE event_waitlist_next (
  id                             TEXT PRIMARY KEY,
  line_account_id                TEXT NOT NULL,
  event_id                       TEXT NOT NULL,
  slot_id                        TEXT NOT NULL,
  friend_id                      TEXT NOT NULL,
  identity_key                   TEXT NOT NULL,
  status                         TEXT NOT NULL DEFAULT 'waiting'
                                 CHECK (status IN (
                                   'waiting', 'offered', 'accepted',
                                   'converted', 'expired', 'cancelled'
                                 )),
  party_size                     INTEGER NOT NULL DEFAULT 1 CHECK (party_size >= 1),
  answer_snapshot_json           TEXT CHECK (
                                   answer_snapshot_json IS NULL OR json_valid(answer_snapshot_json)
  ),
  first_participation            INTEGER CHECK (first_participation IN (0, 1)),
  first_participation_attended_count INTEGER CHECK (
                                   first_participation_attended_count IS NULL
                                   OR first_participation_attended_count >= 0
                                 ),
  first_participation_checked_at TEXT,
  offered_at                     TEXT,
  offer_expires_at               TEXT,
  offer_token_hash               TEXT UNIQUE,
  notified_at                    TEXT,
  version                        INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                     TEXT NOT NULL,
  updated_at                     TEXT NOT NULL,
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (slot_id) REFERENCES event_slots(id),
  FOREIGN KEY (friend_id) REFERENCES friends(id)
);

INSERT INTO event_waitlist_next (
  id, line_account_id, event_id, slot_id, friend_id, identity_key, status,
  party_size, answer_snapshot_json,
  first_participation, first_participation_attended_count,
  first_participation_checked_at,
  offered_at, offer_expires_at, offer_token_hash, notified_at,
  version, created_at, updated_at
)
SELECT
  old.id,
  COALESCE((SELECT f.line_account_id FROM friends AS f WHERE f.id = old.friend_id),
           (SELECT e.line_account_id FROM events AS e WHERE e.id = old.event_id)),
  old.event_id,
  old.slot_id,
  old.friend_id,
  old.identity_key,
  CASE old.status WHEN 'invited' THEN 'offered' ELSE old.status END,
  1,
  NULL,
  CASE WHEN EXISTS (
    SELECT 1
    FROM event_bookings AS prior
    WHERE prior.friend_id = old.friend_id
      AND prior.status = 'attended'
      AND prior.requested_at < old.created_at
  ) THEN 0 ELSE 1 END,
  (
    SELECT COUNT(*)
    FROM event_bookings AS prior
    WHERE prior.friend_id = old.friend_id
      AND prior.status = 'attended'
      AND prior.requested_at < old.created_at
  ),
  old.created_at,
  old.notified_at,
  NULL,
  NULL,
  old.notified_at,
  1,
  old.created_at,
  COALESCE(old.notified_at, old.created_at)
FROM event_waitlist AS old;

DROP TABLE event_waitlist;
ALTER TABLE event_waitlist_next RENAME TO event_waitlist;

-- 履歴は残しつつ、同じ人が同じ回の有効な待ち列へ重複しないようにする。
CREATE UNIQUE INDEX idx_event_waitlist_slot_identity
  ON event_waitlist(slot_id, identity_key)
  WHERE status IN ('waiting', 'offered', 'accepted');
CREATE INDEX idx_event_waitlist_slot_created
  ON event_waitlist(slot_id, status, created_at);
CREATE INDEX idx_event_waitlist_offer_expiry
  ON event_waitlist(status, offer_expires_at);

-- 席解放を失わず、LINE通知失敗時に次のCronで再実行する追記型台帳。
CREATE TABLE event_waitlist_promotion_jobs (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL,
  event_id          TEXT NOT NULL,
  slot_id           TEXT NOT NULL,
  source_key        TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'retryable_failed', 'completed')),
  attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at      TEXT NOT NULL,
  last_error        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  completed_at      TEXT,
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (slot_id) REFERENCES event_slots(id)
);

CREATE INDEX idx_event_waitlist_promotion_due
  ON event_waitlist_promotion_jobs(status, available_at, created_at);
