-- Migration 054: Persist booking customer details on the LINE friend record.
--
-- These columns are intentionally first-class fields rather than metadata-only:
-- birthday delivery and customer lookup need stable, indexable values.

ALTER TABLE friends ADD COLUMN customer_name TEXT;
ALTER TABLE friends ADD COLUMN customer_kana TEXT;
ALTER TABLE friends ADD COLUMN customer_phone TEXT;
ALTER TABLE friends ADD COLUMN customer_birthdate TEXT;
ALTER TABLE friends ADD COLUMN customer_details_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_friends_customer_name
  ON friends (customer_name);
CREATE INDEX IF NOT EXISTS idx_friends_customer_phone
  ON friends (customer_phone);
CREATE INDEX IF NOT EXISTS idx_friends_customer_birthdate
  ON friends (customer_birthdate);

-- Reuse the same store tags for every customer. INSERT OR IGNORE also keeps
-- manually-created tags with these names intact.
INSERT OR IGNORE INTO tags (id, name, color)
VALUES
  ('booking-store-kofu', '甲府店', '#F59E0B'),
  ('booking-store-shibuya', '渋谷店', '#6366F1');

-- Existing customers receive the values from their most recent booking so
-- the migration produces the same state as a newly submitted booking.
UPDATE friends
SET
  customer_name = (
    SELECT b.customer_name
    FROM bookings b
    WHERE b.friend_id = friends.id
    ORDER BY b.requested_at DESC, b.created_at DESC
    LIMIT 1
  ),
  customer_kana = (
    SELECT b.customer_kana
    FROM bookings b
    WHERE b.friend_id = friends.id
    ORDER BY b.requested_at DESC, b.created_at DESC
    LIMIT 1
  ),
  customer_phone = (
    SELECT b.customer_phone
    FROM bookings b
    WHERE b.friend_id = friends.id
    ORDER BY b.requested_at DESC, b.created_at DESC
    LIMIT 1
  ),
  customer_birthdate = (
    SELECT b.customer_birthdate
    FROM bookings b
    WHERE b.friend_id = friends.id
    ORDER BY b.requested_at DESC, b.created_at DESC
    LIMIT 1
  ),
  customer_details_updated_at = (
    SELECT b.requested_at
    FROM bookings b
    WHERE b.friend_id = friends.id
    ORDER BY b.requested_at DESC, b.created_at DESC
    LIMIT 1
  ),
  metadata = json_set(
    COALESCE(NULLIF(metadata, ''), '{}'),
    '$.customer_name', (
      SELECT b.customer_name
      FROM bookings b
      WHERE b.friend_id = friends.id
      ORDER BY b.requested_at DESC, b.created_at DESC
      LIMIT 1
    ),
    '$.customer_kana', (
      SELECT b.customer_kana
      FROM bookings b
      WHERE b.friend_id = friends.id
      ORDER BY b.requested_at DESC, b.created_at DESC
      LIMIT 1
    ),
    '$.customer_phone', (
      SELECT b.customer_phone
      FROM bookings b
      WHERE b.friend_id = friends.id
      ORDER BY b.requested_at DESC, b.created_at DESC
      LIMIT 1
    ),
    '$.customer_birthdate', (
      SELECT b.customer_birthdate
      FROM bookings b
      WHERE b.friend_id = friends.id
      ORDER BY b.requested_at DESC, b.created_at DESC
      LIMIT 1
    )
  )
WHERE EXISTS (
  SELECT 1
  FROM bookings b
  WHERE b.friend_id = friends.id
);

-- A tag is permanent: once a customer has made a booking at a store, deleting
-- or changing a later booking does not remove their visit-history tag.
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id)
SELECT DISTINCT b.friend_id, t.id
FROM bookings b
JOIN booking_locations l ON l.id = b.location_id
JOIN tags t ON t.name = CASE
  WHEN l.name LIKE '%甲府%' THEN '甲府店'
  WHEN l.name LIKE '%渋谷%' THEN '渋谷店'
END
WHERE b.friend_id IS NOT NULL
  AND (l.name LIKE '%甲府%' OR l.name LIKE '%渋谷%');
