-- B-344/B-351: owner-approved range 726..735. Never store raw user agents/IPs here.
CREATE TABLE auth_known_devices (
  staff_id TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (staff_id, device_hash)
);
CREATE INDEX idx_auth_known_devices_last_seen ON auth_known_devices(last_seen_at);
INSERT OR IGNORE INTO auth_known_devices(staff_id, device_hash, first_seen_at, last_seen_at)
SELECT staff_id, device_hash, MIN(created_at), MAX(created_at) FROM admin_sessions
WHERE device_hash IS NOT NULL GROUP BY staff_id, device_hash;
