-- V6 33: organization default and reversible account retirement.
ALTER TABLE line_accounts
  ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1));
ALTER TABLE line_accounts ADD COLUMN archived_at TEXT;
ALTER TABLE line_accounts ADD COLUMN archived_by TEXT;
ALTER TABLE line_accounts ADD COLUMN archived_reason TEXT;

-- Existing organizations start with the first account in display order as
-- their default. `IS` intentionally groups legacy NULL tenant ids together.
UPDATE line_accounts AS current
SET is_default = 1
WHERE archived_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM line_accounts AS earlier
    WHERE earlier.tenant_id IS current.tenant_id
      AND earlier.archived_at IS NULL
      AND (
        earlier.display_order < current.display_order
        OR (earlier.display_order = current.display_order AND earlier.created_at < current.created_at)
        OR (
          earlier.display_order = current.display_order
          AND earlier.created_at = current.created_at
          AND earlier.id < current.id
        )
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_line_accounts_one_default_per_tenant
  ON line_accounts (COALESCE(tenant_id, '00000000-0000-4000-8000-000000000001'))
  WHERE is_default = 1;

CREATE INDEX IF NOT EXISTS idx_line_accounts_archived
  ON line_accounts (archived_at, display_order, created_at);
