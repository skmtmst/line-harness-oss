-- オーナー承認 2026-10-09。既存のバナーは未分類。

CREATE TABLE hq_banner_folders (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 kind TEXT NOT NULL CHECK(kind IN ('project','image')), name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 color TEXT CHECK(color IS NULL OR (typeof(color)='text' AND length(color)=7 AND color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]')), display_order INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 archived_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_hq_banner_folder_name ON hq_banner_folders(tenant_id,kind,name) WHERE archived_at IS NULL;

ALTER TABLE banner_projects ADD COLUMN folder_id TEXT REFERENCES hq_banner_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_banner_projects_folder ON banner_projects(tenant_id,folder_id,archived_at);

CREATE TRIGGER banner_projects_folder_insert BEFORE INSERT ON banner_projects WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hq_banner_folders WHERE id=NEW.folder_id AND tenant_id=NEW.tenant_id AND kind='project' AND archived_at IS NULL) BEGIN SELECT RAISE(ABORT,'folder_assignment_invalid'); END;

CREATE TRIGGER banner_projects_folder_update BEFORE UPDATE OF folder_id,tenant_id ON banner_projects WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hq_banner_folders WHERE id=NEW.folder_id AND tenant_id=NEW.tenant_id AND kind='project' AND archived_at IS NULL) BEGIN SELECT RAISE(ABORT,'folder_assignment_invalid'); END;

ALTER TABLE banner_images ADD COLUMN folder_id TEXT REFERENCES hq_banner_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_banner_images_folder ON banner_images(tenant_id,folder_id,deleted_at);

CREATE TRIGGER banner_images_folder_insert BEFORE INSERT ON banner_images WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hq_banner_folders WHERE id=NEW.folder_id AND tenant_id=NEW.tenant_id AND kind='image' AND archived_at IS NULL) BEGIN SELECT RAISE(ABORT,'folder_assignment_invalid'); END;

CREATE TRIGGER banner_images_folder_update BEFORE UPDATE OF folder_id,tenant_id ON banner_images WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hq_banner_folders WHERE id=NEW.folder_id AND tenant_id=NEW.tenant_id AND kind='image' AND archived_at IS NULL) BEGIN SELECT RAISE(ABORT,'folder_assignment_invalid'); END;
