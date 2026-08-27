-- Add nullable ownership only. Existing rows deliberately remain unassigned and
-- are interpreted as belonging to the default tenant by the application.
ALTER TABLE incoming_webhooks
  ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id);

ALTER TABLE entry_routes
  ADD COLUMN tenant_id TEXT REFERENCES tenants(id);

CREATE INDEX IF NOT EXISTS idx_incoming_webhooks_line_account
  ON incoming_webhooks(line_account_id);
CREATE INDEX IF NOT EXISTS idx_entry_routes_tenant
  ON entry_routes(tenant_id);
