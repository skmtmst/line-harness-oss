-- Add a dedicated read-only permission while preserving existing staff roles.
ALTER TABLE staff_members
  ADD COLUMN access_level TEXT NOT NULL DEFAULT 'full'
  CHECK (access_level IN ('full', 'read_only'));
