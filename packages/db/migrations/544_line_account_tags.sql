-- 統括内でLINEアカウントを分類するタグ。削除してもアカウントは残る。
CREATE TABLE line_account_tags (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  color TEXT CHECK (color IS NULL OR (length(color) = 7 AND color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]')),
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, name)
);
CREATE INDEX idx_line_account_tags_order ON line_account_tags(tenant_id, display_order, name);
CREATE TABLE line_account_tag_links (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  PRIMARY KEY (line_account_id, tag_id),
  FOREIGN KEY (tag_id, tenant_id) REFERENCES line_account_tags(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX idx_line_account_tag_links_tag ON line_account_tag_links(tag_id, line_account_id);
CREATE TRIGGER line_account_tag_links_scope
BEFORE INSERT ON line_account_tag_links
WHEN NOT EXISTS (
  SELECT 1 FROM line_accounts WHERE id = NEW.line_account_id
    AND COALESCE(tenant_id, '00000000-0000-4000-8000-000000000001') = NEW.tenant_id
    AND archived_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_TAG_SCOPE_INVALID'); END;
