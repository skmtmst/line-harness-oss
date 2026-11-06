-- F-13: 自動化・共通アクション・外部連携・成果をアカウント別に分類する草稿。

ALTER TABLE automation_definitions ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX idx_automation_definitions_folder ON automation_definitions(line_account_id, folder_id);
CREATE TRIGGER automation_definitions_folder_insert BEFORE INSERT ON automation_definitions
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'automation' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;
CREATE TRIGGER automation_definitions_folder_update BEFORE UPDATE OF folder_id, line_account_id ON automation_definitions
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'automation' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;
CREATE TRIGGER automation_definitions_folder_delete AFTER DELETE ON folders
BEGIN UPDATE automation_definitions SET folder_id = NULL WHERE folder_id = OLD.id; END;

ALTER TABLE common_actions ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX idx_common_actions_folder ON common_actions(line_account_id, folder_id);
CREATE TRIGGER common_actions_folder_insert BEFORE INSERT ON common_actions
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'common_action' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;
CREATE TRIGGER common_actions_folder_update BEFORE UPDATE OF folder_id, line_account_id ON common_actions
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'common_action' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;
CREATE TRIGGER common_actions_folder_delete AFTER DELETE ON folders
BEGIN UPDATE common_actions SET folder_id = NULL WHERE folder_id = OLD.id; END;

ALTER TABLE incoming_webhooks ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX idx_incoming_webhooks_folder ON incoming_webhooks(line_account_id, folder_id);
CREATE TRIGGER incoming_webhooks_folder_insert BEFORE INSERT ON incoming_webhooks
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'webhook' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;
CREATE TRIGGER incoming_webhooks_folder_update BEFORE UPDATE OF folder_id, line_account_id ON incoming_webhooks
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'webhook' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;
CREATE TRIGGER incoming_webhooks_folder_delete AFTER DELETE ON folders
BEGIN UPDATE incoming_webhooks SET folder_id = NULL WHERE folder_id = OLD.id; END;

ALTER TABLE outgoing_webhooks ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX idx_outgoing_webhooks_folder ON outgoing_webhooks(line_account_id, folder_id);
CREATE TRIGGER outgoing_webhooks_folder_insert BEFORE INSERT ON outgoing_webhooks
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'webhook' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;
CREATE TRIGGER outgoing_webhooks_folder_update BEFORE UPDATE OF folder_id, line_account_id ON outgoing_webhooks
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'webhook' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;
CREATE TRIGGER outgoing_webhooks_folder_delete AFTER DELETE ON folders
BEGIN UPDATE outgoing_webhooks SET folder_id = NULL WHERE folder_id = OLD.id; END;

ALTER TABLE conversion_points ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX idx_conversion_points_folder ON conversion_points(line_account_id, folder_id);
CREATE TRIGGER conversion_points_folder_insert BEFORE INSERT ON conversion_points
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'conversion' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;
CREATE TRIGGER conversion_points_folder_update BEFORE UPDATE OF folder_id, line_account_id ON conversion_points
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'conversion' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;
CREATE TRIGGER conversion_points_folder_delete AFTER DELETE ON folders
BEGIN UPDATE conversion_points SET folder_id = NULL WHERE folder_id = OLD.id; END;
