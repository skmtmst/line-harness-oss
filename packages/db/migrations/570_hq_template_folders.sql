-- V8: ひな形の分類。検証・本番への適用はオーナー承認待ち。
CREATE TABLE hq_template_folders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  revision INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(id, tenant_id)
);
CREATE UNIQUE INDEX idx_hq_folder_name ON hq_template_folders(tenant_id, name) WHERE archived_at IS NULL;
ALTER TABLE hq_templates ADD COLUMN folder_id TEXT;
CREATE INDEX idx_hq_templates_folder ON hq_templates(tenant_id, folder_id, archived_at);
CREATE TRIGGER hq_template_folder_insert BEFORE INSERT ON hq_templates
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hq_template_folders WHERE id=NEW.folder_id AND tenant_id=NEW.tenant_id AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'HQ_FOLDER_SCOPE_INVALID'); END;
CREATE TRIGGER hq_template_folder_update BEFORE UPDATE OF folder_id, tenant_id ON hq_templates
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hq_template_folders WHERE id=NEW.folder_id AND tenant_id=NEW.tenant_id AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'HQ_FOLDER_SCOPE_INVALID'); END;
