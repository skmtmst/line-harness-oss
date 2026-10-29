-- Keep the account creator distinct from tenant-wide and account-scoped members.
ALTER TABLE line_accounts ADD COLUMN created_by_staff_id TEXT REFERENCES staff_members(id) ON DELETE SET NULL;

-- Attribute existing accounts only when an automatic connection check identifies
-- a staff member in the same tenant. Leave all other accounts unattributed.
UPDATE line_accounts
SET created_by_staff_id = (
  SELECT checks.checked_by
  FROM line_account_connection_checks checks
  JOIN staff_members staff ON staff.id = checks.checked_by
  WHERE checks.line_account_id = line_accounts.id
    AND checks.idempotency_key LIKE 'auto-connect-%'
    AND COALESCE(staff.tenant_id, '') = COALESCE(line_accounts.tenant_id, '')
  ORDER BY checks.checked_at ASC, checks.id ASC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM line_account_connection_checks checks
  JOIN staff_members staff ON staff.id = checks.checked_by
  WHERE checks.line_account_id = line_accounts.id
    AND checks.idempotency_key LIKE 'auto-connect-%'
    AND COALESCE(staff.tenant_id, '') = COALESCE(line_accounts.tenant_id, '')
);

CREATE INDEX idx_line_accounts_creator ON line_accounts(created_by_staff_id);
