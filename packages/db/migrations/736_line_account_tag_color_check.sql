-- migration-policy: table-rebuild
-- migration-state: ledger-only
-- D1 rejects the six-character GLOB in 544 as "LIKE or GLOB pattern too complex".
-- Replace it with an equivalent, shorter expression. D1 runs this file atomically.
PRAGMA defer_foreign_keys = ON;

-- The two known dependents have ON DELETE actions; stop if another table appears.
SELECT json(CASE WHEN (
  SELECT count(*) FROM sqlite_schema
  WHERE type='table' AND instr(lower(sql),'references line_account_tags')>0
)=2 AND EXISTS (
  SELECT 1 FROM sqlite_schema WHERE type='table' AND name='line_accounts'
    AND instr(lower(sql),'folder_id text references line_account_tags(id) on delete set null')>0
) AND EXISTS (
  SELECT 1 FROM sqlite_schema WHERE type='table' AND name='line_account_tag_links'
    AND instr(lower(sql),'references line_account_tags(id, tenant_id) on delete cascade')>0
) THEN '{}' ELSE 'unexpected line_account_tags references: stop migration 736' END);

CREATE TABLE migration_736_account_folder_refs_backup AS
  SELECT id, folder_id FROM line_accounts WHERE folder_id IS NOT NULL;
CREATE TABLE migration_736_account_tag_links_backup AS
  SELECT line_account_id, tag_id, tenant_id FROM line_account_tag_links;

DROP TRIGGER line_accounts_folder_scope_insert;
DROP TRIGGER line_accounts_folder_scope_update;
DROP TRIGGER line_account_tag_links_scope;

DELETE FROM line_account_tag_links;
UPDATE line_accounts SET folder_id=NULL WHERE folder_id IS NOT NULL;

CREATE TABLE line_account_tags_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  color TEXT CHECK (color IS NULL OR
    (length(color)=7 AND substr(color,1,1)='#'
      AND substr(color,2) NOT GLOB '*[^0-9A-Fa-f]*')),
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, name)
);
INSERT INTO line_account_tags_new (id,tenant_id,name,color,display_order,created_at,updated_at)
  SELECT id,tenant_id,name,color,display_order,created_at,updated_at FROM line_account_tags;
DROP TABLE line_account_tags;
ALTER TABLE line_account_tags_new RENAME TO line_account_tags;
CREATE INDEX idx_line_account_tags_order ON line_account_tags(tenant_id,display_order,name);

CREATE TRIGGER line_accounts_folder_scope_insert BEFORE INSERT ON line_accounts
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM line_account_tags WHERE id=NEW.folder_id
    AND tenant_id=COALESCE(NEW.tenant_id,'00000000-0000-4000-8000-000000000001')
) BEGIN SELECT RAISE(ABORT,'ACCOUNT_FOLDER_SCOPE_INVALID'); END;
CREATE TRIGGER line_accounts_folder_scope_update BEFORE UPDATE OF folder_id,tenant_id ON line_accounts
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM line_account_tags WHERE id=NEW.folder_id
    AND tenant_id=COALESCE(NEW.tenant_id,'00000000-0000-4000-8000-000000000001')
) BEGIN SELECT RAISE(ABORT,'ACCOUNT_FOLDER_SCOPE_INVALID'); END;

UPDATE line_accounts SET folder_id=(
  SELECT b.folder_id FROM migration_736_account_folder_refs_backup b WHERE b.id=line_accounts.id
) WHERE id IN (SELECT id FROM migration_736_account_folder_refs_backup);
INSERT INTO line_account_tag_links (line_account_id,tag_id,tenant_id)
  SELECT line_account_id,tag_id,tenant_id FROM migration_736_account_tag_links_backup;
CREATE TRIGGER line_account_tag_links_scope
BEFORE INSERT ON line_account_tag_links
WHEN NOT EXISTS (
  SELECT 1 FROM line_accounts WHERE id = NEW.line_account_id
    AND COALESCE(tenant_id, '00000000-0000-4000-8000-000000000001') = NEW.tenant_id
    AND archived_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_TAG_SCOPE_INVALID'); END;

-- The migration must roll back if any dependent row is lost.
SELECT json(CASE WHEN (
  SELECT count(*) FROM line_account_tag_links
)=(SELECT count(*) FROM migration_736_account_tag_links_backup)
AND (
  SELECT count(*) FROM line_accounts WHERE folder_id IS NOT NULL
)=(SELECT count(*) FROM migration_736_account_folder_refs_backup)
THEN '{}' ELSE 'line_account_tags references changed: stop migration 736' END);

DROP TABLE migration_736_account_tag_links_backup;
DROP TABLE migration_736_account_folder_refs_backup;
PRAGMA defer_foreign_keys = OFF;
