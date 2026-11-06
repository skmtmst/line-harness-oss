-- migration-policy: table-rebuild

-- オーナー承認 2026-10-09。D1 適用は司令塔。単一トランザクションで適用する。

-- 外部キーは無効にせず、再建の間だけ検査を遅らせる。退避表は点検用に残す。
-- 新表へのデータの挿入は改名の後。先に写すと参照が復元されても遅延検査の計数が残る。

PRAGMA defer_foreign_keys = ON;

-- 未知の参照を黙って消さず、変更前に止める（D1が許すsqlite_schemaの文字列で検査）。
SELECT json(CASE WHEN (SELECT COALESCE(SUM((length(lower(sql))-length(replace(lower(sql),'references folders','')))/18 + (length(lower(sql))-length(replace(lower(sql),'references "folders"','')))/20 + (length(lower(sql))-length(replace(lower(sql),'references [folders]','')))/20 + (length(lower(sql))-length(replace(lower(sql),'references `folders`','')))/20),0) FROM sqlite_schema WHERE type='table' AND name<>'_cf_METADATA')=19 THEN '{}' ELSE 'unexpected folders references: stop migration 617' END);

SELECT json(CASE WHEN (SELECT COALESCE(SUM((length(lower(sql))-length(replace(lower(sql),'references mileage_rewards','')))/26 + (length(lower(sql))-length(replace(lower(sql),'references "mileage_rewards"','')))/28 + (length(lower(sql))-length(replace(lower(sql),'references [mileage_rewards]','')))/28 + (length(lower(sql))-length(replace(lower(sql),'references `mileage_rewards`','')))/28),0) FROM sqlite_schema WHERE type='table' AND name<>'_cf_METADATA')=2 THEN '{}' ELSE 'unexpected mileage_rewards references: stop migration 617' END);

DROP TRIGGER automation_definitions_folder_delete;

DROP TRIGGER automation_definitions_folder_insert;

DROP TRIGGER automation_definitions_folder_update;

DROP TRIGGER common_actions_folder_delete;

DROP TRIGGER common_actions_folder_insert;

DROP TRIGGER common_actions_folder_update;

DROP TRIGGER conversion_points_folder_delete;

DROP TRIGGER conversion_points_folder_insert;

DROP TRIGGER conversion_points_folder_update;

DROP TRIGGER hq_template_folder_insert;

DROP TRIGGER hq_template_folder_update;

DROP TRIGGER incoming_webhooks_folder_delete;

DROP TRIGGER incoming_webhooks_folder_insert;

DROP TRIGGER incoming_webhooks_folder_update;

DROP TRIGGER outgoing_webhooks_folder_delete;

DROP TRIGGER outgoing_webhooks_folder_insert;

DROP TRIGGER outgoing_webhooks_folder_update;

CREATE TABLE _617_backup_auto_replies (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_auto_replies SELECT id, folder_id FROM auto_replies;

CREATE TABLE _617_backup_automation_definitions (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_automation_definitions SELECT id, folder_id FROM automation_definitions;

CREATE TABLE _617_backup_broadcasts (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_broadcasts SELECT id, folder_id FROM broadcasts;

CREATE TABLE _617_backup_common_actions (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_common_actions SELECT id, folder_id FROM common_actions;

CREATE TABLE _617_backup_common_vars (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_common_vars SELECT id, folder_id FROM common_vars;

CREATE TABLE _617_backup_conversion_points (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_conversion_points SELECT id, folder_id FROM conversion_points;

CREATE TABLE _617_backup_forms (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_forms SELECT id, folder_id FROM forms;

CREATE TABLE _617_backup_friend_fields (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_friend_fields SELECT id, folder_id FROM friend_fields;

CREATE TABLE _617_backup_incoming_webhooks (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_incoming_webhooks SELECT id, folder_id FROM incoming_webhooks;

CREATE TABLE _617_backup_media (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_media SELECT id, folder_id FROM media;

CREATE TABLE _617_backup_media_upload_sessions (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_media_upload_sessions SELECT id, folder_id FROM media_upload_sessions;

CREATE TABLE _617_backup_outgoing_webhooks (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_outgoing_webhooks SELECT id, folder_id FROM outgoing_webhooks;

CREATE TABLE _617_backup_reminders (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_reminders SELECT id, folder_id FROM reminders;

CREATE TABLE _617_backup_rich_menu_groups (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_rich_menu_groups SELECT id, folder_id FROM rich_menu_groups;

CREATE TABLE _617_backup_scenarios (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_scenarios SELECT id, folder_id FROM scenarios;

CREATE TABLE _617_backup_tags (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_tags SELECT id, folder_id FROM tags;

CREATE TABLE _617_backup_templates (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_templates SELECT id, folder_id FROM templates;

CREATE TABLE _617_backup_webinars (id TEXT PRIMARY KEY, folder_id TEXT);

INSERT INTO _617_backup_webinars SELECT id, folder_id FROM webinars;

CREATE TABLE _617_backup_folder_parents (id TEXT PRIMARY KEY, parent_id TEXT);

INSERT INTO _617_backup_folder_parents SELECT id,parent_id FROM folders;

CREATE TABLE folders_new (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'tag','template','scenario','reminder','auto_reply',
                  'rich_menu','webinar','form','media','common_var',
                  'mileage_rule','automation','event','entry_route','broadcast',
                  'friend_field','common_action','webhook','conversion','affiliate','affiliate_offer','mileage_reward','friend_add_rule')),
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES folders(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  color         TEXT,
  account_id    TEXT REFERENCES line_accounts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
);

CREATE TABLE _617_backup_folders AS SELECT * FROM folders;

DROP TABLE folders;

ALTER TABLE folders_new RENAME TO folders;

INSERT INTO folders (id,kind,name,parent_id,display_order,created_at,updated_at,color,account_id) SELECT id,kind,name,NULL,display_order,created_at,updated_at,color,account_id FROM _617_backup_folders;

CREATE INDEX idx_folders_kind_order_556 ON folders(kind, display_order);

CREATE INDEX idx_folders_webinar_account_order_556
  ON folders(kind, account_id, display_order, name);

UPDATE folders SET parent_id = (SELECT parent_id FROM _617_backup_folder_parents b WHERE b.id=folders.id);

UPDATE auto_replies SET folder_id = (SELECT folder_id FROM _617_backup_auto_replies b WHERE b.id=auto_replies.id) WHERE EXISTS (SELECT 1 FROM _617_backup_auto_replies b WHERE b.id=auto_replies.id);

UPDATE automation_definitions SET folder_id = (SELECT folder_id FROM _617_backup_automation_definitions b WHERE b.id=automation_definitions.id) WHERE EXISTS (SELECT 1 FROM _617_backup_automation_definitions b WHERE b.id=automation_definitions.id);

UPDATE broadcasts SET folder_id = (SELECT folder_id FROM _617_backup_broadcasts b WHERE b.id=broadcasts.id) WHERE EXISTS (SELECT 1 FROM _617_backup_broadcasts b WHERE b.id=broadcasts.id);

UPDATE common_actions SET folder_id = (SELECT folder_id FROM _617_backup_common_actions b WHERE b.id=common_actions.id) WHERE EXISTS (SELECT 1 FROM _617_backup_common_actions b WHERE b.id=common_actions.id);

UPDATE common_vars SET folder_id = (SELECT folder_id FROM _617_backup_common_vars b WHERE b.id=common_vars.id) WHERE EXISTS (SELECT 1 FROM _617_backup_common_vars b WHERE b.id=common_vars.id);

UPDATE conversion_points SET folder_id = (SELECT folder_id FROM _617_backup_conversion_points b WHERE b.id=conversion_points.id) WHERE EXISTS (SELECT 1 FROM _617_backup_conversion_points b WHERE b.id=conversion_points.id);

UPDATE forms SET folder_id = (SELECT folder_id FROM _617_backup_forms b WHERE b.id=forms.id) WHERE EXISTS (SELECT 1 FROM _617_backup_forms b WHERE b.id=forms.id);

UPDATE friend_fields SET folder_id = (SELECT folder_id FROM _617_backup_friend_fields b WHERE b.id=friend_fields.id) WHERE EXISTS (SELECT 1 FROM _617_backup_friend_fields b WHERE b.id=friend_fields.id);

UPDATE incoming_webhooks SET folder_id = (SELECT folder_id FROM _617_backup_incoming_webhooks b WHERE b.id=incoming_webhooks.id) WHERE EXISTS (SELECT 1 FROM _617_backup_incoming_webhooks b WHERE b.id=incoming_webhooks.id);

UPDATE media SET folder_id = (SELECT folder_id FROM _617_backup_media b WHERE b.id=media.id) WHERE EXISTS (SELECT 1 FROM _617_backup_media b WHERE b.id=media.id);

UPDATE media_upload_sessions SET folder_id = (SELECT folder_id FROM _617_backup_media_upload_sessions b WHERE b.id=media_upload_sessions.id) WHERE EXISTS (SELECT 1 FROM _617_backup_media_upload_sessions b WHERE b.id=media_upload_sessions.id);

UPDATE outgoing_webhooks SET folder_id = (SELECT folder_id FROM _617_backup_outgoing_webhooks b WHERE b.id=outgoing_webhooks.id) WHERE EXISTS (SELECT 1 FROM _617_backup_outgoing_webhooks b WHERE b.id=outgoing_webhooks.id);

UPDATE reminders SET folder_id = (SELECT folder_id FROM _617_backup_reminders b WHERE b.id=reminders.id) WHERE EXISTS (SELECT 1 FROM _617_backup_reminders b WHERE b.id=reminders.id);

UPDATE rich_menu_groups SET folder_id = (SELECT folder_id FROM _617_backup_rich_menu_groups b WHERE b.id=rich_menu_groups.id) WHERE EXISTS (SELECT 1 FROM _617_backup_rich_menu_groups b WHERE b.id=rich_menu_groups.id);

UPDATE scenarios SET folder_id = (SELECT folder_id FROM _617_backup_scenarios b WHERE b.id=scenarios.id) WHERE EXISTS (SELECT 1 FROM _617_backup_scenarios b WHERE b.id=scenarios.id);

UPDATE tags SET folder_id = (SELECT folder_id FROM _617_backup_tags b WHERE b.id=tags.id) WHERE EXISTS (SELECT 1 FROM _617_backup_tags b WHERE b.id=tags.id);

UPDATE templates SET folder_id = (SELECT folder_id FROM _617_backup_templates b WHERE b.id=templates.id) WHERE EXISTS (SELECT 1 FROM _617_backup_templates b WHERE b.id=templates.id);

UPDATE webinars SET folder_id = (SELECT folder_id FROM _617_backup_webinars b WHERE b.id=webinars.id) WHERE EXISTS (SELECT 1 FROM _617_backup_webinars b WHERE b.id=webinars.id);

CREATE TRIGGER automation_definitions_folder_delete AFTER DELETE ON folders
BEGIN UPDATE automation_definitions SET folder_id = NULL WHERE folder_id = OLD.id; END;

CREATE TRIGGER automation_definitions_folder_insert BEFORE INSERT ON automation_definitions
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'automation' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;

CREATE TRIGGER automation_definitions_folder_update BEFORE UPDATE OF folder_id, line_account_id ON automation_definitions
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'automation' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;

CREATE TRIGGER common_actions_folder_delete AFTER DELETE ON folders
BEGIN UPDATE common_actions SET folder_id = NULL WHERE folder_id = OLD.id; END;

CREATE TRIGGER common_actions_folder_insert BEFORE INSERT ON common_actions
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'common_action' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;

CREATE TRIGGER common_actions_folder_update BEFORE UPDATE OF folder_id, line_account_id ON common_actions
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'common_action' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;

CREATE TRIGGER conversion_points_folder_delete AFTER DELETE ON folders
BEGIN UPDATE conversion_points SET folder_id = NULL WHERE folder_id = OLD.id; END;

CREATE TRIGGER conversion_points_folder_insert BEFORE INSERT ON conversion_points
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'conversion' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;

CREATE TRIGGER conversion_points_folder_update BEFORE UPDATE OF folder_id, line_account_id ON conversion_points
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'conversion' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;

CREATE TRIGGER hq_template_folder_insert BEFORE INSERT ON hq_templates
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hq_template_folders WHERE id=NEW.folder_id AND tenant_id=NEW.tenant_id AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'HQ_FOLDER_SCOPE_INVALID'); END;

CREATE TRIGGER hq_template_folder_update BEFORE UPDATE OF folder_id, tenant_id ON hq_templates
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hq_template_folders WHERE id=NEW.folder_id AND tenant_id=NEW.tenant_id AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'HQ_FOLDER_SCOPE_INVALID'); END;

CREATE TRIGGER incoming_webhooks_folder_delete AFTER DELETE ON folders
BEGIN UPDATE incoming_webhooks SET folder_id = NULL WHERE folder_id = OLD.id; END;

CREATE TRIGGER incoming_webhooks_folder_insert BEFORE INSERT ON incoming_webhooks
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'webhook' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;

CREATE TRIGGER incoming_webhooks_folder_update BEFORE UPDATE OF folder_id, line_account_id ON incoming_webhooks
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'webhook' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;

CREATE TRIGGER outgoing_webhooks_folder_delete AFTER DELETE ON folders
BEGIN UPDATE outgoing_webhooks SET folder_id = NULL WHERE folder_id = OLD.id; END;

CREATE TRIGGER outgoing_webhooks_folder_insert BEFORE INSERT ON outgoing_webhooks
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'webhook' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;

CREATE TRIGGER outgoing_webhooks_folder_update BEFORE UPDATE OF folder_id, line_account_id ON outgoing_webhooks
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM folders WHERE id = NEW.folder_id AND kind = 'webhook' AND account_id = NEW.line_account_id
) BEGIN SELECT RAISE(ABORT, 'folder_assignment_invalid'); END;

INSERT INTO folders (id,kind,account_id,name,display_order,created_at,updated_at) SELECT id,'mileage_reward',line_account_id,name,display_order,created_at,updated_at FROM mileage_reward_folders;

INSERT INTO folders (id,kind,account_id,name,color,display_order,created_at,updated_at) SELECT id,'friend_add_rule',line_account_id,name,color,ROW_NUMBER() OVER (PARTITION BY line_account_id ORDER BY name,id)-1,created_at,updated_at FROM friend_add_rule_folders;

INSERT INTO folders (id,kind,account_id,name,display_order,created_at,updated_at) SELECT 'friend-add-name-'||hex(line_account_id)||'-'||hex(folder_name),'friend_add_rule',line_account_id,folder_name,0,MIN(created_at),MAX(updated_at) FROM friend_add_rules r WHERE folder_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders f WHERE f.kind='friend_add_rule' AND f.account_id=r.line_account_id AND f.name=r.folder_name) GROUP BY line_account_id,folder_name;

ALTER TABLE affiliates ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;

ALTER TABLE affiliate_offers ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;

ALTER TABLE friend_add_rules ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;

UPDATE friend_add_rules SET folder_id=(SELECT id FROM folders f WHERE f.kind='friend_add_rule' AND f.account_id=friend_add_rules.line_account_id AND f.name=friend_add_rules.folder_name);

CREATE TABLE mileage_rewards_new (
  id                           TEXT PRIMARY KEY,
  line_account_id              TEXT NOT NULL REFERENCES line_accounts(id),
  program_id                   TEXT NOT NULL DEFAULT 'default' REFERENCES mileage_programs(id),
  name                         TEXT NOT NULL,
  description                  TEXT,
  image_url                    TEXT,
  reward_kind                  TEXT NOT NULL
                                 CHECK (reward_kind IN (
                                   'coupon', 'tag', 'scenario', 'template',
                                   'early_access', 'rank'
                                 )),
  status                       TEXT NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'published', 'stopped', 'archived')),
  sort_order                   INTEGER NOT NULL DEFAULT 0,
  current_draft_version_id     TEXT REFERENCES mileage_reward_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  current_published_version_id TEXT REFERENCES mileage_reward_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  created_by                   TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at                  TEXT
, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL);

CREATE TABLE _617_backup_mileage_rewards AS SELECT * FROM mileage_rewards;

DROP TABLE mileage_rewards;

ALTER TABLE mileage_rewards_new RENAME TO mileage_rewards;

INSERT INTO mileage_rewards (id,line_account_id,program_id,name,description,image_url,reward_kind,status,sort_order,current_draft_version_id,current_published_version_id,created_by,created_at,updated_at,archived_at,folder_id) SELECT id,line_account_id,program_id,name,description,image_url,reward_kind,status,sort_order,current_draft_version_id,current_published_version_id,created_by,created_at,updated_at,archived_at,folder_id FROM _617_backup_mileage_rewards;

CREATE INDEX idx_mileage_rewards_account_status
  ON mileage_rewards(line_account_id, status, sort_order, updated_at DESC);

CREATE INDEX idx_mileage_rewards_folder ON mileage_rewards(line_account_id, folder_id);

CREATE INDEX idx_affiliates_folder ON affiliates(line_account_id,folder_id);

CREATE TRIGGER affiliates_folder_insert BEFORE INSERT ON affiliates WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders WHERE id=NEW.folder_id AND kind='affiliate' AND account_id=NEW.line_account_id) BEGIN SELECT RAISE(ABORT,'folder_assignment_invalid'); END;

CREATE TRIGGER affiliates_folder_update BEFORE UPDATE OF folder_id,line_account_id ON affiliates WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders WHERE id=NEW.folder_id AND kind='affiliate' AND account_id=NEW.line_account_id) BEGIN SELECT RAISE(ABORT,'folder_assignment_invalid'); END;

CREATE INDEX idx_affiliate_offers_folder ON affiliate_offers(line_account_id,folder_id);

CREATE TRIGGER affiliate_offers_folder_insert BEFORE INSERT ON affiliate_offers WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders WHERE id=NEW.folder_id AND kind='affiliate_offer' AND account_id=NEW.line_account_id) BEGIN SELECT RAISE(ABORT,'folder_assignment_invalid'); END;

CREATE TRIGGER affiliate_offers_folder_update BEFORE UPDATE OF folder_id,line_account_id ON affiliate_offers WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders WHERE id=NEW.folder_id AND kind='affiliate_offer' AND account_id=NEW.line_account_id) BEGIN SELECT RAISE(ABORT,'folder_assignment_invalid'); END;

CREATE TRIGGER mileage_rewards_folder_insert BEFORE INSERT ON mileage_rewards WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders WHERE id=NEW.folder_id AND kind='mileage_reward' AND account_id=NEW.line_account_id) BEGIN SELECT RAISE(ABORT,'folder_assignment_invalid'); END;

CREATE TRIGGER mileage_rewards_folder_update BEFORE UPDATE OF folder_id,line_account_id ON mileage_rewards WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders WHERE id=NEW.folder_id AND kind='mileage_reward' AND account_id=NEW.line_account_id) BEGIN SELECT RAISE(ABORT,'folder_assignment_invalid'); END;

CREATE INDEX idx_friend_add_rules_folder ON friend_add_rules(line_account_id,folder_id);

CREATE TRIGGER friend_add_rules_folder_insert BEFORE INSERT ON friend_add_rules WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders WHERE id=NEW.folder_id AND kind='friend_add_rule' AND account_id=NEW.line_account_id) BEGIN SELECT RAISE(ABORT,'folder_assignment_invalid'); END;

CREATE TRIGGER friend_add_rules_folder_update BEFORE UPDATE OF folder_id,line_account_id ON friend_add_rules WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders WHERE id=NEW.folder_id AND kind='friend_add_rule' AND account_id=NEW.line_account_id) BEGIN SELECT RAISE(ABORT,'folder_assignment_invalid'); END;

CREATE UNIQUE INDEX idx_folders_friend_add_name ON folders(account_id,name) WHERE kind='friend_add_rule';

-- 友だち追加の名前の呼び口と共通のIDの呼び口を同期する。公開版・実行履歴は変更しない。

CREATE TRIGGER friend_add_rules_folder_name_insert AFTER INSERT ON friend_add_rules WHEN NEW.folder_name IS NOT NULL AND NEW.folder_id IS NULL BEGIN INSERT OR IGNORE INTO folders(id,kind,account_id,name) SELECT 'friend-add-name-'||hex(NEW.line_account_id)||'-'||hex(NEW.folder_name)||'-'||lower(hex(randomblob(8))),'friend_add_rule',NEW.line_account_id,NEW.folder_name WHERE NOT EXISTS(SELECT 1 FROM folders WHERE kind='friend_add_rule' AND account_id=NEW.line_account_id AND name=NEW.folder_name); UPDATE friend_add_rules SET folder_id=(SELECT id FROM folders WHERE kind='friend_add_rule' AND account_id=NEW.line_account_id AND name=NEW.folder_name) WHERE id=NEW.id; END;

CREATE TRIGGER friend_add_rules_folder_name_update AFTER UPDATE OF folder_name ON friend_add_rules WHEN NEW.folder_name IS NOT OLD.folder_name BEGIN INSERT INTO folders(id,kind,account_id,name) SELECT 'friend-add-name-'||hex(NEW.line_account_id)||'-'||hex(NEW.folder_name)||'-'||lower(hex(randomblob(8))),'friend_add_rule',NEW.line_account_id,NEW.folder_name WHERE NEW.folder_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders WHERE kind='friend_add_rule' AND account_id=NEW.line_account_id AND name=NEW.folder_name); UPDATE friend_add_rules SET folder_id=(SELECT id FROM folders WHERE kind='friend_add_rule' AND account_id=NEW.line_account_id AND name=NEW.folder_name) WHERE id=NEW.id; END;

CREATE TRIGGER friend_add_rules_folder_id_update AFTER UPDATE OF folder_id ON friend_add_rules WHEN NEW.folder_id IS NOT OLD.folder_id BEGIN UPDATE friend_add_rules SET folder_name=(SELECT name FROM folders WHERE id=NEW.folder_id),lock_version=lock_version+1 WHERE id=NEW.id AND folder_name IS NOT (SELECT name FROM folders WHERE id=NEW.folder_id); END;

CREATE TRIGGER folders_friend_add_rename AFTER UPDATE OF name ON folders WHEN NEW.kind='friend_add_rule' AND NEW.name IS NOT OLD.name BEGIN UPDATE friend_add_rules SET folder_name=NEW.name,lock_version=lock_version+1,updated_at=NEW.updated_at WHERE folder_id=NEW.id AND line_account_id=NEW.account_id; END;

CREATE TRIGGER mileage_reward_folders_common_insert AFTER INSERT ON mileage_reward_folders WHEN NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.id) BEGIN INSERT INTO folders(id,kind,account_id,name,display_order,created_at,updated_at) VALUES(NEW.id,'mileage_reward',NEW.line_account_id,NEW.name,NEW.display_order,NEW.created_at,NEW.updated_at); END;

CREATE TRIGGER mileage_reward_folders_common_update AFTER UPDATE ON mileage_reward_folders WHEN EXISTS(SELECT 1 FROM folders WHERE id=NEW.id AND (name IS NOT NEW.name OR display_order IS NOT NEW.display_order)) BEGIN UPDATE folders SET name=NEW.name,display_order=NEW.display_order,revision=revision+1,updated_at=NEW.updated_at WHERE id=NEW.id AND kind='mileage_reward' AND account_id=NEW.line_account_id; END;

CREATE TRIGGER mileage_reward_folders_common_delete AFTER DELETE ON mileage_reward_folders BEGIN DELETE FROM folders WHERE id=OLD.id AND kind='mileage_reward' AND account_id=OLD.line_account_id; END;

CREATE TRIGGER folders_mileage_reward_legacy_insert AFTER INSERT ON folders WHEN NEW.kind='mileage_reward' BEGIN INSERT OR IGNORE INTO mileage_reward_folders(id,line_account_id,name,display_order,created_at,updated_at) VALUES(NEW.id,NEW.account_id,NEW.name,NEW.display_order,NEW.created_at,NEW.updated_at); END;

CREATE TRIGGER folders_mileage_reward_legacy_update AFTER UPDATE ON folders WHEN NEW.kind='mileage_reward' BEGIN UPDATE mileage_reward_folders SET name=NEW.name,display_order=NEW.display_order,updated_at=NEW.updated_at WHERE id=NEW.id AND line_account_id=NEW.account_id AND (name IS NOT NEW.name OR display_order IS NOT NEW.display_order); END;

CREATE TRIGGER folders_mileage_reward_legacy_delete AFTER DELETE ON folders WHEN OLD.kind='mileage_reward' BEGIN DELETE FROM mileage_reward_folders WHERE id=OLD.id AND line_account_id=OLD.account_id; END;

CREATE TRIGGER friend_add_rule_folders_common_insert AFTER INSERT ON friend_add_rule_folders WHEN NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.id) BEGIN INSERT INTO folders(id,kind,account_id,name,color,created_at,updated_at) VALUES(NEW.id,'friend_add_rule',NEW.line_account_id,NEW.name,NEW.color,NEW.created_at,NEW.updated_at); END;

CREATE TRIGGER friend_add_rule_folders_common_update AFTER UPDATE ON friend_add_rule_folders WHEN EXISTS(SELECT 1 FROM folders WHERE id=NEW.id AND (name IS NOT NEW.name OR color IS NOT NEW.color)) BEGIN UPDATE folders SET name=NEW.name,color=NEW.color,revision=revision+1,updated_at=NEW.updated_at WHERE id=NEW.id AND kind='friend_add_rule' AND account_id=NEW.line_account_id; END;

CREATE TRIGGER friend_add_rule_folders_common_delete AFTER DELETE ON friend_add_rule_folders BEGIN DELETE FROM folders WHERE id=OLD.id AND kind='friend_add_rule' AND account_id=OLD.line_account_id; END;

CREATE TRIGGER folders_friend_add_rule_legacy_insert AFTER INSERT ON folders WHEN NEW.kind='friend_add_rule' BEGIN INSERT OR IGNORE INTO friend_add_rule_folders(id,line_account_id,name,color,created_at,updated_at,create_idempotency_key,created_by_staff_id) VALUES(NEW.id,NEW.account_id,NEW.name,NEW.color,NEW.created_at,NEW.updated_at,'common-'||NEW.id,'folder-api'); END;

CREATE TRIGGER folders_friend_add_rule_legacy_update AFTER UPDATE ON folders WHEN NEW.kind='friend_add_rule' BEGIN UPDATE friend_add_rule_folders SET name=NEW.name,color=NEW.color,updated_at=NEW.updated_at WHERE id=NEW.id AND line_account_id=NEW.account_id AND (name IS NOT NEW.name OR color IS NOT NEW.color); END;

CREATE TRIGGER folders_friend_add_rule_legacy_delete AFTER DELETE ON folders WHEN OLD.kind='friend_add_rule' BEGIN DELETE FROM friend_add_rule_folders WHERE id=OLD.id AND line_account_id=OLD.account_id; END;

INSERT OR IGNORE INTO friend_add_rule_folders(id,line_account_id,name,color,create_idempotency_key,created_by_staff_id,created_at,updated_at) SELECT id,account_id,name,color,'common-'||id,'folder-api',created_at,updated_at FROM folders WHERE kind='friend_add_rule';

CREATE TRIGGER friend_add_rules_folder_id_insert AFTER INSERT ON friend_add_rules WHEN NEW.folder_id IS NOT NULL BEGIN UPDATE friend_add_rules SET folder_name=(SELECT name FROM folders WHERE id=NEW.folder_id) WHERE id=NEW.id AND folder_name IS NOT (SELECT name FROM folders WHERE id=NEW.folder_id); END;
