-- 既存タグをフォルダの辞書として再利用。旧タグAPIとリンクは移行期間中も残す。
ALTER TABLE line_accounts ADD COLUMN folder_id TEXT REFERENCES line_account_tags(id) ON DELETE SET NULL;
CREATE INDEX idx_line_accounts_folder ON line_accounts(folder_id);
-- 複数タグは表示順、名前、IDの順で先頭を採用。0件はNULL（未分類）。
UPDATE line_accounts SET folder_id = (
  SELECT t.id FROM line_account_tag_links l JOIN line_account_tags t
    ON t.id=l.tag_id AND t.tenant_id=l.tenant_id
  WHERE l.line_account_id=line_accounts.id
    AND t.tenant_id=COALESCE(line_accounts.tenant_id,'00000000-0000-4000-8000-000000000001')
  ORDER BY t.display_order,t.name,t.id LIMIT 1
);
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
