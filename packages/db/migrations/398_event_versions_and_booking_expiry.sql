-- N-418 / N-422: immutable event publications and booking-time snapshots.

ALTER TABLE events ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE events ADD COLUMN current_published_version_id TEXT;
ALTER TABLE events ADD COLUMN version_write_token TEXT;
ALTER TABLE events ADD COLUMN approval_deadline_hours INTEGER NOT NULL DEFAULT 24
  CHECK (approval_deadline_hours IN (2, 24, 72));

CREATE TABLE event_versions (
  id                       TEXT PRIMARY KEY,
  event_id                 TEXT NOT NULL,
  line_account_id          TEXT NOT NULL,
  version_number           INTEGER NOT NULL,
  snapshot_json            TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  approval_deadline_hours  INTEGER NOT NULL CHECK (approval_deadline_hours IN (2, 24, 72)),
  published_at             TEXT NOT NULL,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  UNIQUE (event_id, version_number)
);
CREATE INDEX idx_event_versions_account_event
  ON event_versions (line_account_id, event_id, version_number DESC);

ALTER TABLE event_bookings ADD COLUMN event_version_id TEXT REFERENCES event_versions(id);
ALTER TABLE event_bookings ADD COLUMN event_snapshot_json TEXT CHECK (event_snapshot_json IS NULL OR json_valid(event_snapshot_json));
ALTER TABLE event_bookings ADD COLUMN approval_expires_at TEXT;
CREATE INDEX idx_event_bookings_requested_expiry
  ON event_bookings (status, approval_expires_at);

ALTER TABLE event_waitlist ADD COLUMN event_version_id TEXT REFERENCES event_versions(id);
ALTER TABLE event_waitlist ADD COLUMN event_snapshot_json TEXT CHECK (event_snapshot_json IS NULL OR json_valid(event_snapshot_json));

-- Existing published definitions become immutable migration version 1.
INSERT INTO event_versions (
  id, event_id, line_account_id, version_number, snapshot_json,
  approval_deadline_hours, published_at
)
SELECT
  'event-version:' || e.id || ':1', e.id, e.line_account_id, 1,
  json_object(
    'eventName', e.name,
    'eventImageUrl', e.image_url,
    'eventDescription', e.description,
    'venueName', e.venue_name,
    'venueUrl', e.venue_url,
    'cancelDeadlineHoursBefore', e.cancel_deadline_hours_before,
    'confirmationMessageExtra', e.confirmation_message_extra,
    'approvalDeadlineHours', 24
  ),
  24,
  COALESCE(NULLIF(e.updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM events e
WHERE e.is_published = 1 AND e.deleted_at IS NULL;

UPDATE events
SET current_published_version_id = 'event-version:' || id || ':1'
WHERE is_published = 1 AND deleted_at IS NULL;

-- Old rows have no configurable deadline. Preserve the historical 24h rule and
-- freeze the event/occurrence text that their history displayed before migration.
UPDATE event_bookings
SET event_version_id = (
      SELECT e.current_published_version_id FROM events e WHERE e.id = event_bookings.event_id
    ),
    event_snapshot_json = (
      SELECT json_object(
        'eventName', e.name,
        'eventImageUrl', e.image_url,
        'eventDescription', e.description,
        'venueName', e.venue_name,
        'venueUrl', e.venue_url,
        'cancelDeadlineHoursBefore', e.cancel_deadline_hours_before,
        'confirmationMessageExtra', e.confirmation_message_extra,
        'slotStartsAt', s.starts_at,
        'slotEndsAt', s.ends_at,
        'approvalDeadlineHours', 24
      )
      FROM events e
      JOIN event_slots s ON s.id = event_bookings.slot_id
      WHERE e.id = event_bookings.event_id
    ),
    approval_expires_at = CASE
      WHEN status = 'requested'
        THEN strftime('%Y-%m-%dT%H:%M:%fZ', requested_at, '+24 hours')
      ELSE NULL
    END;

-- A waitlist entry is also an application. Freeze the version and occurrence
-- text now so a later promotion cannot turn a pre-migration application into
-- the event's latest edited definition.
UPDATE event_waitlist
SET event_version_id = (
      SELECT e.current_published_version_id FROM events e WHERE e.id = event_waitlist.event_id
    ),
    event_snapshot_json = (
      SELECT json_object(
        'eventName', e.name,
        'eventImageUrl', e.image_url,
        'eventDescription', e.description,
        'venueName', e.venue_name,
        'venueUrl', e.venue_url,
        'cancelDeadlineHoursBefore', e.cancel_deadline_hours_before,
        'confirmationMessageExtra', e.confirmation_message_extra,
        'slotStartsAt', s.starts_at,
        'slotEndsAt', s.ends_at,
        'approvalDeadlineHours', 24
      )
      FROM events e
      JOIN event_slots s ON s.id = event_waitlist.slot_id
      WHERE e.id = event_waitlist.event_id
    );
