-- migration-policy: table-rebuild

-- Remove only the legacy database-wide tags.name UNIQUE constraint.

-- D1 applies this file transactionally. Do not execute statements individually on a live database.

-- Foreign keys stay enabled: defer_foreign_keys alone does NOT prevent DELETE actions.

-- Disconnect nullable references; preserve CASCADE leaves, including complete scenario trigger rows.

PRAGMA defer_foreign_keys = ON;

-- D1 rejects a dynamic pragma_foreign_key_list(m.name) join with SQLITE_AUTH,
-- and expanding every PRAGMA into one UNION can exceed D1's compound SELECT
-- limit. Keep every assertion as a small fixed-table query instead.
SELECT json(CASE WHEN (SELECT count(*) FROM pragma_foreign_key_list('affiliate_offers') WHERE "table" = 'tags') = 1 AND EXISTS(SELECT 1 FROM pragma_foreign_key_list('affiliate_offers') WHERE "table" = 'tags' AND "from" = 'tag_id' AND on_delete = 'NO ACTION') THEN '{}' ELSE 'unexpected tags foreign key: affiliate_offers.tag_id' END);
SELECT json(CASE WHEN (SELECT count(*) FROM pragma_foreign_key_list('broadcasts') WHERE "table" = 'tags') = 1 AND EXISTS(SELECT 1 FROM pragma_foreign_key_list('broadcasts') WHERE "table" = 'tags' AND "from" = 'target_tag_id' AND on_delete = 'SET NULL') THEN '{}' ELSE 'unexpected tags foreign key: broadcasts.target_tag_id' END);
SELECT json(CASE WHEN (SELECT count(*) FROM pragma_foreign_key_list('entry_routes') WHERE "table" = 'tags') = 1 AND EXISTS(SELECT 1 FROM pragma_foreign_key_list('entry_routes') WHERE "table" = 'tags' AND "from" = 'tag_id' AND on_delete = 'SET NULL') THEN '{}' ELSE 'unexpected tags foreign key: entry_routes.tag_id' END);
SELECT json(CASE WHEN (SELECT count(*) FROM pragma_foreign_key_list('forms') WHERE "table" = 'tags') = 1 AND EXISTS(SELECT 1 FROM pragma_foreign_key_list('forms') WHERE "table" = 'tags' AND "from" = 'on_submit_tag_id' AND on_delete = 'SET NULL') THEN '{}' ELSE 'unexpected tags foreign key: forms.on_submit_tag_id' END);
SELECT json(CASE WHEN (SELECT count(*) FROM pragma_foreign_key_list('friend_tag_side_effect_runs') WHERE "table" = 'tags') = 1 AND EXISTS(SELECT 1 FROM pragma_foreign_key_list('friend_tag_side_effect_runs') WHERE "table" = 'tags' AND "from" = 'tag_id' AND on_delete = 'CASCADE') THEN '{}' ELSE 'unexpected tags foreign key: friend_tag_side_effect_runs.tag_id' END);
SELECT json(CASE WHEN (SELECT count(*) FROM pragma_foreign_key_list('friend_tags') WHERE "table" = 'tags') = 1 AND EXISTS(SELECT 1 FROM pragma_foreign_key_list('friend_tags') WHERE "table" = 'tags' AND "from" = 'tag_id' AND on_delete = 'CASCADE') THEN '{}' ELSE 'unexpected tags foreign key: friend_tags.tag_id' END);
SELECT json(CASE WHEN (SELECT count(*) FROM pragma_foreign_key_list('menus') WHERE "table" = 'tags') = 1 AND EXISTS(SELECT 1 FROM pragma_foreign_key_list('menus') WHERE "table" = 'tags' AND "from" = 'auto_tag_id' AND on_delete = 'SET NULL') THEN '{}' ELSE 'unexpected tags foreign key: menus.auto_tag_id' END);
SELECT json(CASE WHEN (SELECT count(*) FROM pragma_foreign_key_list('nen_columns') WHERE "table" = 'tags') = 2 AND EXISTS(SELECT 1 FROM pragma_foreign_key_list('nen_columns') WHERE "table" = 'tags' AND "from" = 'completion_tag_id' AND on_delete = 'SET NULL') AND EXISTS(SELECT 1 FROM pragma_foreign_key_list('nen_columns') WHERE "table" = 'tags' AND "from" = 'target_tag_id' AND on_delete = 'SET NULL') THEN '{}' ELSE 'unexpected tags foreign keys: nen_columns' END);
SELECT json(CASE WHEN (SELECT count(*) FROM pragma_foreign_key_list('reminders') WHERE "table" = 'tags') = 1 AND EXISTS(SELECT 1 FROM pragma_foreign_key_list('reminders') WHERE "table" = 'tags' AND "from" = 'target_tag_id' AND on_delete = 'SET NULL') THEN '{}' ELSE 'unexpected tags foreign key: reminders.target_tag_id' END);
SELECT json(CASE WHEN (SELECT count(*) FROM pragma_foreign_key_list('scenario_steps') WHERE "table" = 'tags') = 1 AND EXISTS(SELECT 1 FROM pragma_foreign_key_list('scenario_steps') WHERE "table" = 'tags' AND "from" = 'on_reach_tag_id' AND on_delete = 'SET NULL') THEN '{}' ELSE 'unexpected tags foreign key: scenario_steps.on_reach_tag_id' END);
SELECT json(CASE WHEN (SELECT count(*) FROM pragma_foreign_key_list('scenario_triggers') WHERE "table" = 'tags') = 1 AND EXISTS(SELECT 1 FROM pragma_foreign_key_list('scenario_triggers') WHERE "table" = 'tags' AND "from" = 'tag_id' AND on_delete = 'CASCADE') THEN '{}' ELSE 'unexpected tags foreign key: scenario_triggers.tag_id' END);
SELECT json(CASE WHEN (SELECT count(*) FROM pragma_foreign_key_list('scenarios') WHERE "table" = 'tags') = 1 AND EXISTS(SELECT 1 FROM pragma_foreign_key_list('scenarios') WHERE "table" = 'tags' AND "from" = 'trigger_tag_id' AND on_delete = 'SET NULL') THEN '{}' ELSE 'unexpected tags foreign key: scenarios.trigger_tag_id' END);
SELECT json(CASE WHEN (SELECT count(*) FROM pragma_foreign_key_list('tracked_links') WHERE "table" = 'tags') = 1 AND EXISTS(SELECT 1 FROM pragma_foreign_key_list('tracked_links') WHERE "table" = 'tags' AND "from" = 'tag_id' AND on_delete = 'SET NULL') THEN '{}' ELSE 'unexpected tags foreign key: tracked_links.tag_id' END);

SELECT json(CASE WHEN NOT EXISTS(
 SELECT 1 FROM sqlite_schema
 WHERE type = 'table' AND name != '_cf_METADATA'
 AND name NOT IN ('affiliate_offers', 'broadcasts', 'entry_routes', 'forms', 'friend_tag_side_effect_runs', 'friend_tags', 'menus', 'nen_columns', 'reminders', 'scenario_steps', 'scenario_triggers', 'scenarios', 'tracked_links')
 AND (
   lower(sql) LIKE '%references tags%'
   OR lower(sql) LIKE '%references "tags"%'
   OR lower(sql) LIKE '%references [tags]%'
   OR lower(sql) LIKE '%references `tags`%'
 )
) THEN '{}' ELSE 'unexpected table references tags: stop migration 382' END);

SELECT json(CASE WHEN NOT EXISTS(
 SELECT 1 FROM sqlite_schema
 WHERE type = 'table' AND name != '_cf_METADATA'
 AND (
   lower(sql) LIKE '%references scenario_triggers%'
   OR lower(sql) LIKE '%references "scenario_triggers"%'
   OR lower(sql) LIKE '%references [scenario_triggers]%'
   OR lower(sql) LIKE '%references `scenario_triggers`%'
   OR lower(sql) LIKE '%references friend_tags%'
   OR lower(sql) LIKE '%references "friend_tags"%'
   OR lower(sql) LIKE '%references [friend_tags]%'
   OR lower(sql) LIKE '%references `friend_tags`%'
   OR lower(sql) LIKE '%references friend_tag_side_effect_runs%'
   OR lower(sql) LIKE '%references "friend_tag_side_effect_runs"%'
   OR lower(sql) LIKE '%references [friend_tag_side_effect_runs]%'
   OR lower(sql) LIKE '%references `friend_tag_side_effect_runs`%'
 )
) AND (SELECT count(*) FROM pragma_table_info('scenario_triggers')) = 5
 THEN '{}' ELSE 'unexpected cascade leaf schema: stop migration 382' END);

CREATE TABLE migration_382_tag_refs_backup (table_name TEXT NOT NULL, row_id INTEGER NOT NULL, column_name TEXT NOT NULL, tag_id TEXT, row_data TEXT);

INSERT INTO migration_382_tag_refs_backup (table_name, row_id, column_name, tag_id) SELECT 'affiliate_offers', rowid, 'tag_id', tag_id FROM affiliate_offers;

INSERT INTO migration_382_tag_refs_backup (table_name, row_id, column_name, tag_id) SELECT 'broadcasts', rowid, 'target_tag_id', target_tag_id FROM broadcasts;

INSERT INTO migration_382_tag_refs_backup (table_name, row_id, column_name, tag_id) SELECT 'entry_routes', rowid, 'tag_id', tag_id FROM entry_routes;

INSERT INTO migration_382_tag_refs_backup (table_name, row_id, column_name, tag_id) SELECT 'forms', rowid, 'on_submit_tag_id', on_submit_tag_id FROM forms;

INSERT INTO migration_382_tag_refs_backup (table_name, row_id, column_name, tag_id) SELECT 'menus', rowid, 'auto_tag_id', auto_tag_id FROM menus;

INSERT INTO migration_382_tag_refs_backup (table_name, row_id, column_name, tag_id) SELECT 'nen_columns', rowid, 'completion_tag_id', completion_tag_id FROM nen_columns;

INSERT INTO migration_382_tag_refs_backup (table_name, row_id, column_name, tag_id) SELECT 'nen_columns', rowid, 'target_tag_id', target_tag_id FROM nen_columns;

INSERT INTO migration_382_tag_refs_backup (table_name, row_id, column_name, tag_id) SELECT 'reminders', rowid, 'target_tag_id', target_tag_id FROM reminders;

INSERT INTO migration_382_tag_refs_backup (table_name, row_id, column_name, tag_id) SELECT 'scenario_steps', rowid, 'on_reach_tag_id', on_reach_tag_id FROM scenario_steps;

-- Setting tag_id to NULL would collide with the expression unique index for two
-- tag_added triggers in one scenario. Preserve every column and the rowid instead.
INSERT INTO migration_382_tag_refs_backup (table_name, row_id, column_name, tag_id, row_data)
 SELECT 'scenario_triggers', rowid, 'tag_id', tag_id,
 json_object('id', id, 'scenario_id', scenario_id, 'kind', kind, 'tag_id', tag_id, 'created_at', created_at)
 FROM scenario_triggers;

INSERT INTO migration_382_tag_refs_backup (table_name, row_id, column_name, tag_id) SELECT 'scenarios', rowid, 'trigger_tag_id', trigger_tag_id FROM scenarios;

INSERT INTO migration_382_tag_refs_backup (table_name, row_id, column_name, tag_id) SELECT 'tracked_links', rowid, 'tag_id', tag_id FROM tracked_links;

CREATE TABLE migration_382_friend_tag_side_effect_runs_backup AS SELECT * FROM friend_tag_side_effect_runs;

CREATE TABLE migration_382_friend_tags_backup AS SELECT * FROM friend_tags;

UPDATE affiliate_offers SET tag_id = NULL WHERE tag_id IS NOT NULL;

UPDATE broadcasts SET target_tag_id = NULL WHERE target_tag_id IS NOT NULL;

UPDATE entry_routes SET tag_id = NULL WHERE tag_id IS NOT NULL;

UPDATE forms SET on_submit_tag_id = NULL WHERE on_submit_tag_id IS NOT NULL;

UPDATE menus SET auto_tag_id = NULL WHERE auto_tag_id IS NOT NULL;

UPDATE nen_columns SET completion_tag_id = NULL WHERE completion_tag_id IS NOT NULL;

UPDATE nen_columns SET target_tag_id = NULL WHERE target_tag_id IS NOT NULL;

UPDATE reminders SET target_tag_id = NULL WHERE target_tag_id IS NOT NULL;

UPDATE scenario_steps SET on_reach_tag_id = NULL WHERE on_reach_tag_id IS NOT NULL;

DELETE FROM scenario_triggers;

UPDATE scenarios SET trigger_tag_id = NULL WHERE trigger_tag_id IS NOT NULL;

UPDATE tracked_links SET tag_id = NULL WHERE tag_id IS NOT NULL;

DELETE FROM friend_tag_side_effect_runs;

DELETE FROM friend_tags;

CREATE TABLE tags_new (
  id                          TEXT PRIMARY KEY,
  name                        TEXT NOT NULL,
  color                       TEXT NOT NULL DEFAULT '#3B82F6',
  mileage_reward              INTEGER NOT NULL DEFAULT 0 CHECK (mileage_reward >= 0),
  referral_mileage_reward     INTEGER NOT NULL DEFAULT 0 CHECK (referral_mileage_reward >= 0),
  mileage_multiplier_bps      INTEGER CHECK (mileage_multiplier_bps IS NULL OR mileage_multiplier_bps BETWEEN 1000 AND 100000),
  mileage_multiplier_priority INTEGER NOT NULL DEFAULT 0,
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, group_id TEXT REFERENCES tag_groups(id) ON DELETE SET NULL, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, is_starred INTEGER NOT NULL DEFAULT 0, display_order INTEGER NOT NULL DEFAULT 0, line_account_id TEXT REFERENCES line_accounts(id), description TEXT, normalized_name TEXT, manual_assignment_allowed INTEGER NOT NULL DEFAULT 1
  CHECK (manual_assignment_allowed IN (0, 1)), reapply_policy TEXT NOT NULL DEFAULT 'first_only'
  CHECK (reapply_policy IN ('first_only', 'every_time')), linked_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (linked_enabled IN (0, 1)), status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived')), version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), created_by TEXT, updated_by TEXT, updated_at TEXT, created_from_recipe_id TEXT REFERENCES recipes(id), recipe_clone_run_id TEXT REFERENCES recipe_clone_runs(id));

INSERT INTO tags_new SELECT * FROM tags;

DROP TABLE tags;

ALTER TABLE tags_new RENAME TO tags;

CREATE UNIQUE INDEX idx_tags_account_normalized_name
  ON tags(line_account_id, normalized_name)
  WHERE line_account_id IS NOT NULL AND normalized_name IS NOT NULL;

-- Preserve legacy/global exact-name uniqueness even for old NULL normalized_name.
-- Scoped tags keep the account + normalized_name index above.
CREATE UNIQUE INDEX idx_tags_legacy_name ON tags(name) WHERE line_account_id IS NULL;

-- New global writers persist the NFKC comparison key. This closes concurrent
-- create races; application writers also normalize old NULL rows before writes.
CREATE UNIQUE INDEX idx_tags_legacy_normalized_name
  ON tags(normalized_name)
  WHERE line_account_id IS NULL AND normalized_name IS NOT NULL;

-- Older account-owned rows can still have NULL normalized_name. Include both old
-- and normalized rows so an exact-name duplicate cannot cross between the two.
CREATE UNIQUE INDEX idx_tags_account_exact_name
  ON tags(line_account_id, name) WHERE line_account_id IS NOT NULL;

CREATE INDEX idx_tags_account_status_name
  ON tags(line_account_id, status, name, id);

CREATE INDEX idx_tags_group ON tags(group_id, name);

CREATE INDEX idx_tags_line_account
  ON tags(line_account_id, display_order, id);

CREATE INDEX idx_tags_order ON tags (folder_id, display_order);

UPDATE affiliate_offers SET tag_id = (SELECT tag_id FROM migration_382_tag_refs_backup b WHERE b.table_name = 'affiliate_offers' AND b.column_name = 'tag_id' AND b.row_id = affiliate_offers.rowid);

UPDATE broadcasts SET target_tag_id = (SELECT tag_id FROM migration_382_tag_refs_backup b WHERE b.table_name = 'broadcasts' AND b.column_name = 'target_tag_id' AND b.row_id = broadcasts.rowid);

UPDATE entry_routes SET tag_id = (SELECT tag_id FROM migration_382_tag_refs_backup b WHERE b.table_name = 'entry_routes' AND b.column_name = 'tag_id' AND b.row_id = entry_routes.rowid);

UPDATE forms SET on_submit_tag_id = (SELECT tag_id FROM migration_382_tag_refs_backup b WHERE b.table_name = 'forms' AND b.column_name = 'on_submit_tag_id' AND b.row_id = forms.rowid);

UPDATE menus SET auto_tag_id = (SELECT tag_id FROM migration_382_tag_refs_backup b WHERE b.table_name = 'menus' AND b.column_name = 'auto_tag_id' AND b.row_id = menus.rowid);

UPDATE nen_columns SET completion_tag_id = (SELECT tag_id FROM migration_382_tag_refs_backup b WHERE b.table_name = 'nen_columns' AND b.column_name = 'completion_tag_id' AND b.row_id = nen_columns.rowid);

UPDATE nen_columns SET target_tag_id = (SELECT tag_id FROM migration_382_tag_refs_backup b WHERE b.table_name = 'nen_columns' AND b.column_name = 'target_tag_id' AND b.row_id = nen_columns.rowid);

UPDATE reminders SET target_tag_id = (SELECT tag_id FROM migration_382_tag_refs_backup b WHERE b.table_name = 'reminders' AND b.column_name = 'target_tag_id' AND b.row_id = reminders.rowid);

UPDATE scenario_steps SET on_reach_tag_id = (SELECT tag_id FROM migration_382_tag_refs_backup b WHERE b.table_name = 'scenario_steps' AND b.column_name = 'on_reach_tag_id' AND b.row_id = scenario_steps.rowid);

INSERT INTO scenario_triggers (rowid, id, scenario_id, kind, tag_id, created_at)
 SELECT row_id, json_extract(row_data, '$.id'), json_extract(row_data, '$.scenario_id'),
 json_extract(row_data, '$.kind'), json_extract(row_data, '$.tag_id'), json_extract(row_data, '$.created_at')
 FROM migration_382_tag_refs_backup WHERE table_name = 'scenario_triggers';

UPDATE scenarios SET trigger_tag_id = (SELECT tag_id FROM migration_382_tag_refs_backup b WHERE b.table_name = 'scenarios' AND b.column_name = 'trigger_tag_id' AND b.row_id = scenarios.rowid);

UPDATE tracked_links SET tag_id = (SELECT tag_id FROM migration_382_tag_refs_backup b WHERE b.table_name = 'tracked_links' AND b.column_name = 'tag_id' AND b.row_id = tracked_links.rowid);

INSERT INTO friend_tag_side_effect_runs SELECT * FROM migration_382_friend_tag_side_effect_runs_backup;

INSERT INTO friend_tags SELECT * FROM migration_382_friend_tags_backup;

SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM migration_382_tag_refs_backup b LEFT JOIN affiliate_offers t ON t.rowid = b.row_id WHERE b.table_name = 'affiliate_offers' AND b.column_name = 'tag_id' AND (t.rowid IS NOT b.row_id OR t.tag_id IS NOT b.tag_id)) THEN '{}' ELSE 'tag reference restoration failed' END);

SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM migration_382_tag_refs_backup b LEFT JOIN broadcasts t ON t.rowid = b.row_id WHERE b.table_name = 'broadcasts' AND b.column_name = 'target_tag_id' AND (t.rowid IS NOT b.row_id OR t.target_tag_id IS NOT b.tag_id)) THEN '{}' ELSE 'tag reference restoration failed' END);

SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM migration_382_tag_refs_backup b LEFT JOIN entry_routes t ON t.rowid = b.row_id WHERE b.table_name = 'entry_routes' AND b.column_name = 'tag_id' AND (t.rowid IS NOT b.row_id OR t.tag_id IS NOT b.tag_id)) THEN '{}' ELSE 'tag reference restoration failed' END);

SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM migration_382_tag_refs_backup b LEFT JOIN forms t ON t.rowid = b.row_id WHERE b.table_name = 'forms' AND b.column_name = 'on_submit_tag_id' AND (t.rowid IS NOT b.row_id OR t.on_submit_tag_id IS NOT b.tag_id)) THEN '{}' ELSE 'tag reference restoration failed' END);

SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM migration_382_tag_refs_backup b LEFT JOIN menus t ON t.rowid = b.row_id WHERE b.table_name = 'menus' AND b.column_name = 'auto_tag_id' AND (t.rowid IS NOT b.row_id OR t.auto_tag_id IS NOT b.tag_id)) THEN '{}' ELSE 'tag reference restoration failed' END);

SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM migration_382_tag_refs_backup b LEFT JOIN nen_columns t ON t.rowid = b.row_id WHERE b.table_name = 'nen_columns' AND b.column_name = 'completion_tag_id' AND (t.rowid IS NOT b.row_id OR t.completion_tag_id IS NOT b.tag_id)) THEN '{}' ELSE 'tag reference restoration failed' END);

SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM migration_382_tag_refs_backup b LEFT JOIN nen_columns t ON t.rowid = b.row_id WHERE b.table_name = 'nen_columns' AND b.column_name = 'target_tag_id' AND (t.rowid IS NOT b.row_id OR t.target_tag_id IS NOT b.tag_id)) THEN '{}' ELSE 'tag reference restoration failed' END);

SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM migration_382_tag_refs_backup b LEFT JOIN reminders t ON t.rowid = b.row_id WHERE b.table_name = 'reminders' AND b.column_name = 'target_tag_id' AND (t.rowid IS NOT b.row_id OR t.target_tag_id IS NOT b.tag_id)) THEN '{}' ELSE 'tag reference restoration failed' END);

SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM migration_382_tag_refs_backup b LEFT JOIN scenario_steps t ON t.rowid = b.row_id WHERE b.table_name = 'scenario_steps' AND b.column_name = 'on_reach_tag_id' AND (t.rowid IS NOT b.row_id OR t.on_reach_tag_id IS NOT b.tag_id)) THEN '{}' ELSE 'tag reference restoration failed' END);

SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM migration_382_tag_refs_backup b LEFT JOIN scenario_triggers t ON t.rowid = b.row_id WHERE b.table_name = 'scenario_triggers' AND b.column_name = 'tag_id' AND (t.rowid IS NOT b.row_id OR t.tag_id IS NOT b.tag_id OR json_object('id', t.id, 'scenario_id', t.scenario_id, 'kind', t.kind, 'tag_id', t.tag_id, 'created_at', t.created_at) IS NOT b.row_data)) THEN '{}' ELSE 'tag reference restoration failed' END);

SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM migration_382_tag_refs_backup b LEFT JOIN scenarios t ON t.rowid = b.row_id WHERE b.table_name = 'scenarios' AND b.column_name = 'trigger_tag_id' AND (t.rowid IS NOT b.row_id OR t.trigger_tag_id IS NOT b.tag_id)) THEN '{}' ELSE 'tag reference restoration failed' END);

SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM migration_382_tag_refs_backup b LEFT JOIN tracked_links t ON t.rowid = b.row_id WHERE b.table_name = 'tracked_links' AND b.column_name = 'tag_id' AND (t.rowid IS NOT b.row_id OR t.tag_id IS NOT b.tag_id)) THEN '{}' ELSE 'tag reference restoration failed' END);

SELECT json(CASE WHEN NOT EXISTS(SELECT * FROM friend_tag_side_effect_runs EXCEPT SELECT * FROM migration_382_friend_tag_side_effect_runs_backup) AND NOT EXISTS(SELECT * FROM migration_382_friend_tag_side_effect_runs_backup EXCEPT SELECT * FROM friend_tag_side_effect_runs) THEN '{}' ELSE 'tag cascade restoration failed' END);

SELECT json(CASE WHEN NOT EXISTS(SELECT * FROM friend_tags EXCEPT SELECT * FROM migration_382_friend_tags_backup) AND NOT EXISTS(SELECT * FROM migration_382_friend_tags_backup EXCEPT SELECT * FROM friend_tags) THEN '{}' ELSE 'tag cascade restoration failed' END);

SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check) THEN '{}' ELSE 'foreign key check failed after tag rebuild' END);

DROP TABLE migration_382_tag_refs_backup;

DROP TABLE migration_382_friend_tag_side_effect_runs_backup;

DROP TABLE migration_382_friend_tags_backup;

PRAGMA foreign_key_check;

PRAGMA defer_foreign_keys = OFF;
