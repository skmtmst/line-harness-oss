-- Normalize scheduled scenario delivery times to one sortable JST format.
-- strftime parses Z / explicit offsets as instants, then '+9 hours' renders
-- the same instant as local JST clock time. Invalid values are left untouched
-- so the required dry-run can surface them without silently dropping a send.
UPDATE friend_scenarios
SET next_delivery_at =
  strftime('%Y-%m-%dT%H:%M:%f', next_delivery_at, '+9 hours') || '+09:00'
WHERE next_delivery_at IS NOT NULL
  AND (
    substr(next_delivery_at, -1) IN ('Z', 'z')
    OR substr(next_delivery_at, -6, 1) IN ('+', '-')
  )
  AND strftime('%Y-%m-%dT%H:%M:%f', next_delivery_at, '+9 hours') IS NOT NULL
  AND next_delivery_at !=
    strftime('%Y-%m-%dT%H:%M:%f', next_delivery_at, '+9 hours') || '+09:00';

-- The due-delivery query filters and orders by this timestamp before LIMIT.
CREATE INDEX IF NOT EXISTS idx_friend_scenarios_due_delivery
ON friend_scenarios (next_delivery_at, id)
WHERE status = 'active' AND next_delivery_at IS NOT NULL;
