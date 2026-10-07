-- migration-policy: table-rebuild
-- 草稿：オーナー承認後に司令塔が適用する。本作業ではD1へ適用しない。
-- イメージマップと配信用素材を一斉配信・シナリオの正式な種類に加える。
-- D1は外部キーが有効。CASCADEの履歴を退避し、参照を戻してから控えを片付ける。
PRAGMA defer_foreign_keys = ON;
CREATE TABLE migration_593_broadcast_after_action_runs_backup AS SELECT * FROM broadcast_after_action_runs;
CREATE TABLE migration_593_broadcast_approval_events_backup AS SELECT * FROM broadcast_approval_events;
CREATE TABLE migration_593_broadcast_insights_backup AS SELECT * FROM broadcast_insights;
CREATE TABLE migration_593_broadcast_lifecycle_events_backup AS SELECT * FROM broadcast_lifecycle_events;
CREATE TABLE migration_593_broadcast_send_claims_backup AS SELECT * FROM broadcast_send_claims;
CREATE TABLE migration_593_broadcast_tracked_links_backup AS SELECT * FROM broadcast_tracked_links;
CREATE TABLE migration_593_scenario_actions_backup AS SELECT * FROM scenario_actions;
CREATE TABLE migration_593_scenario_action_fires_backup AS SELECT * FROM scenario_action_fires;
CREATE TABLE migration_593_message_refs_backup AS SELECT id,broadcast_id,scenario_step_id FROM messages_log WHERE broadcast_id IS NOT NULL OR scenario_step_id IS NOT NULL;

CREATE TABLE broadcasts_new (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  message_type       TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'location', 'video', 'audio', 'sticker', 'carousel', 'imagemap', 'rich_message', 'coupon')),
  message_content    TEXT NOT NULL,
  target_type        TEXT NOT NULL CHECK (target_type IN ('all', 'tag', 'segment', 'multi-account-dedup')) DEFAULT 'all',
  target_tag_id      TEXT REFERENCES tags (id) ON DELETE SET NULL,
  status             TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'sending', 'sent')) DEFAULT 'draft',
  scheduled_at       TEXT,
  sent_at            TEXT,
  total_count        INTEGER NOT NULL DEFAULT 0,
  success_count      INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  line_account_id    TEXT,
  alt_text           TEXT,
  line_request_id    TEXT,
  aggregation_unit   TEXT,
  batch_offset       INTEGER NOT NULL DEFAULT 0,
  segment_conditions TEXT,
  account_ids        TEXT CHECK (account_ids IS NULL OR json_valid(account_ids)),
  dedup_priority     TEXT CHECK (dedup_priority IS NULL OR json_valid(dedup_priority)),
  failed_account_ids TEXT CHECK (failed_account_ids IS NULL OR json_valid(failed_account_ids)),
  dedup_progress     TEXT,
  batch_lock_at      TEXT,
  track_links        INTEGER NOT NULL DEFAULT 1,
  message_bubbles_json TEXT CHECK (message_bubbles_json IS NULL OR json_valid(message_bubbles_json)),
  stealth_spread_minutes INTEGER NOT NULL DEFAULT 0
, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, measure_opens INTEGER NOT NULL DEFAULT 1, internal_memo TEXT, draft_step TEXT
  CHECK (draft_step IS NULL OR draft_step IN ('basic', 'audience', 'message', 'schedule', 'confirm')), draft_payload_json TEXT
  CHECK (draft_payload_json IS NULL OR json_valid(draft_payload_json)), message_options_json TEXT
  CHECK (message_options_json IS NULL OR json_valid(message_options_json)), after_action_version_id TEXT
  REFERENCES common_action_versions(id) ON DELETE RESTRICT, lock_version INTEGER NOT NULL DEFAULT 1
  CHECK (lock_version > 0), stopped_at TEXT, stopped_by TEXT, send_attempt_no INTEGER NOT NULL DEFAULT 1, common_var_snapshot TEXT
  CHECK (common_var_snapshot IS NULL OR json_valid(common_var_snapshot)), common_var_snapshot_at TEXT, approval_status TEXT NOT NULL DEFAULT 'none', approval_requested_by_staff_id TEXT, approval_requested_at TEXT, approval_approver_staff_id TEXT, approval_note TEXT, approval_decided_by_staff_id TEXT, approval_decided_at TEXT, approval_reject_reason TEXT, approval_confirmed_count INTEGER);
INSERT INTO broadcasts_new (id,title,message_type,message_content,target_type,target_tag_id,status,scheduled_at,sent_at,total_count,success_count,created_at,line_account_id,alt_text,line_request_id,aggregation_unit,batch_offset,segment_conditions,account_ids,dedup_priority,failed_account_ids,dedup_progress,batch_lock_at,track_links,message_bubbles_json,stealth_spread_minutes,folder_id,measure_opens,internal_memo,draft_step,draft_payload_json,message_options_json,after_action_version_id,lock_version,stopped_at,stopped_by,send_attempt_no,common_var_snapshot,common_var_snapshot_at,approval_status,approval_requested_by_staff_id,approval_requested_at,approval_approver_staff_id,approval_note,approval_decided_by_staff_id,approval_decided_at,approval_reject_reason,approval_confirmed_count) SELECT id,title,message_type,message_content,target_type,target_tag_id,status,scheduled_at,sent_at,total_count,success_count,created_at,line_account_id,alt_text,line_request_id,aggregation_unit,batch_offset,segment_conditions,account_ids,dedup_priority,failed_account_ids,dedup_progress,batch_lock_at,track_links,message_bubbles_json,stealth_spread_minutes,folder_id,measure_opens,internal_memo,draft_step,draft_payload_json,message_options_json,after_action_version_id,lock_version,stopped_at,stopped_by,send_attempt_no,common_var_snapshot,common_var_snapshot_at,approval_status,approval_requested_by_staff_id,approval_requested_at,approval_approver_staff_id,approval_note,approval_decided_by_staff_id,approval_decided_at,approval_reject_reason,approval_confirmed_count FROM broadcasts;
DROP TABLE broadcasts;
ALTER TABLE broadcasts_new RENAME TO broadcasts;
CREATE INDEX idx_broadcasts_approval_approver ON broadcasts (approval_approver_staff_id);
CREATE INDEX idx_broadcasts_approval_status ON broadcasts (approval_status);
CREATE INDEX idx_broadcasts_status_lookup ON broadcasts (status);
CREATE INDEX idx_broadcasts_stopped
  ON broadcasts (status, stopped_at);

CREATE TABLE scenario_steps_new (
  id              TEXT PRIMARY KEY,
  scenario_id     TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  step_order      INTEGER NOT NULL,
  delay_minutes   INTEGER NOT NULL DEFAULT 0,
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'location', 'video', 'audio', 'sticker', 'carousel', 'imagemap', 'rich_message', 'coupon')),
  message_content TEXT NOT NULL,
  message_bubbles_json TEXT CHECK (message_bubbles_json IS NULL OR json_valid(message_bubbles_json)),
  offset_days     INTEGER,
  offset_minutes  INTEGER,
  delivery_time   TEXT,
  template_id     TEXT REFERENCES templates(id) ON DELETE SET NULL,
  on_reach_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  condition_type  TEXT,
  condition_value TEXT,
  next_step_on_false INTEGER,
  after_send      TEXT NOT NULL DEFAULT 'continue' CHECK (after_send IN ('continue', 'pause')),
  target_condition_json TEXT,
  question_json   TEXT,
  is_draft        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (scenario_id, step_order)
);
INSERT INTO scenario_steps_new (id,scenario_id,step_order,delay_minutes,message_type,message_content,message_bubbles_json,offset_days,offset_minutes,delivery_time,template_id,on_reach_tag_id,created_at,condition_type,condition_value,next_step_on_false,after_send,target_condition_json,question_json,is_draft) SELECT id,scenario_id,step_order,delay_minutes,message_type,message_content,message_bubbles_json,offset_days,offset_minutes,delivery_time,template_id,on_reach_tag_id,created_at,condition_type,condition_value,next_step_on_false,after_send,target_condition_json,question_json,is_draft FROM scenario_steps;
DROP TABLE scenario_steps;
ALTER TABLE scenario_steps_new RENAME TO scenario_steps;
CREATE INDEX idx_scenario_steps_scenario_lookup ON scenario_steps (scenario_id);
INSERT INTO broadcast_after_action_runs SELECT * FROM migration_593_broadcast_after_action_runs_backup;
INSERT INTO broadcast_approval_events SELECT * FROM migration_593_broadcast_approval_events_backup;
INSERT INTO broadcast_insights SELECT * FROM migration_593_broadcast_insights_backup;
INSERT INTO broadcast_lifecycle_events SELECT * FROM migration_593_broadcast_lifecycle_events_backup;
INSERT INTO broadcast_send_claims SELECT * FROM migration_593_broadcast_send_claims_backup;
INSERT INTO broadcast_tracked_links SELECT * FROM migration_593_broadcast_tracked_links_backup;
INSERT INTO scenario_actions SELECT * FROM migration_593_scenario_actions_backup;
INSERT INTO scenario_action_fires SELECT * FROM migration_593_scenario_action_fires_backup;
UPDATE messages_log SET broadcast_id=(SELECT broadcast_id FROM migration_593_message_refs_backup b WHERE b.id=messages_log.id),scenario_step_id=(SELECT scenario_step_id FROM migration_593_message_refs_backup b WHERE b.id=messages_log.id) WHERE id IN (SELECT id FROM migration_593_message_refs_backup);
DROP TABLE migration_593_broadcast_after_action_runs_backup;
DROP TABLE migration_593_broadcast_approval_events_backup;
DROP TABLE migration_593_broadcast_insights_backup;
DROP TABLE migration_593_broadcast_lifecycle_events_backup;
DROP TABLE migration_593_broadcast_send_claims_backup;
DROP TABLE migration_593_broadcast_tracked_links_backup;
DROP TABLE migration_593_scenario_actions_backup;
DROP TABLE migration_593_scenario_action_fires_backup;
DROP TABLE migration_593_message_refs_backup;

-- テンプレートへ保存しても同じ種類を保ち、公開版と参照を復元する。
CREATE TABLE migration_593_template_versions_backup AS SELECT * FROM template_versions;
CREATE TABLE migration_593_template_references_backup AS SELECT * FROM template_references;
CREATE TABLE migration_593_template_publish_keys_backup AS SELECT * FROM template_publish_keys;
CREATE TABLE migration_593_auto_replies_template_refs_backup AS SELECT id,template_id FROM auto_replies WHERE template_id IS NOT NULL;
CREATE TABLE migration_593_scenario_steps_template_refs_backup AS SELECT id,template_id FROM scenario_steps WHERE template_id IS NOT NULL;
CREATE TABLE templates_new (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'carousel', 'imagemap', 'rich_message', 'coupon')),
  message_content TEXT NOT NULL,
  -- 162: カルーセルの選択肢を押したときの動き。
  -- { "0": { "0": [アクションの並び] } }（パネル番号 → 選択肢番号 → 中身）
  carousel_actions_json TEXT,
  -- 162: 選択肢の押せる回数。'none'（制限なし）／'once'（全体で1回）
  carousel_tap_limit_mode TEXT NOT NULL DEFAULT 'none',
  -- 162: 制限を超えたときに返すテキスト。空なら何も返さない。
  carousel_tap_limit_text TEXT,
  -- 質問テンプレート。scenario_steps.question_json と同じ形。
  question_json TEXT CHECK (question_json IS NULL OR json_valid(question_json)),
  question_status TEXT NOT NULL DEFAULT 'published' CHECK (question_status IN ('draft', 'published')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, display_order INTEGER NOT NULL DEFAULT 0, line_account_id TEXT REFERENCES line_accounts(id), created_from_recipe_id TEXT REFERENCES recipes(id), recipe_clone_run_id TEXT REFERENCES recipe_clone_runs(id), published_version INTEGER NOT NULL DEFAULT 1, published_at TEXT, draft_message_type TEXT, draft_message_content TEXT, draft_carousel_actions_json TEXT, draft_carousel_tap_limit_mode TEXT, draft_carousel_tap_limit_text TEXT, draft_question_json TEXT
  CHECK (draft_question_json IS NULL OR json_valid(draft_question_json)), draft_question_status TEXT
  CHECK (draft_question_status IS NULL OR draft_question_status IN ('draft', 'published')), publish_idempotency_key TEXT, draft_revision INTEGER NOT NULL DEFAULT 0);
INSERT INTO templates_new (id,name,category,message_type,message_content,carousel_actions_json,carousel_tap_limit_mode,carousel_tap_limit_text,question_json,question_status,created_at,updated_at,folder_id,display_order,line_account_id,created_from_recipe_id,recipe_clone_run_id,published_version,published_at,draft_message_type,draft_message_content,draft_carousel_actions_json,draft_carousel_tap_limit_mode,draft_carousel_tap_limit_text,draft_question_json,draft_question_status,publish_idempotency_key,draft_revision) SELECT id,name,category,message_type,message_content,carousel_actions_json,carousel_tap_limit_mode,carousel_tap_limit_text,question_json,question_status,created_at,updated_at,folder_id,display_order,line_account_id,created_from_recipe_id,recipe_clone_run_id,published_version,published_at,draft_message_type,draft_message_content,draft_carousel_actions_json,draft_carousel_tap_limit_mode,draft_carousel_tap_limit_text,draft_question_json,draft_question_status,publish_idempotency_key,draft_revision FROM templates;
DROP TABLE templates;
ALTER TABLE templates_new RENAME TO templates;
CREATE INDEX idx_templates_category ON templates (category);
CREATE INDEX idx_templates_line_account
  ON templates(line_account_id, display_order, id);
CREATE INDEX idx_templates_publish_key ON templates (publish_idempotency_key);
INSERT INTO template_versions SELECT * FROM migration_593_template_versions_backup;
INSERT INTO template_references SELECT * FROM migration_593_template_references_backup;
INSERT INTO template_publish_keys SELECT * FROM migration_593_template_publish_keys_backup;
UPDATE auto_replies SET template_id=(SELECT b.template_id FROM migration_593_auto_replies_template_refs_backup b WHERE b.id=auto_replies.id) WHERE id IN (SELECT id FROM migration_593_auto_replies_template_refs_backup);
UPDATE scenario_steps SET template_id=(SELECT b.template_id FROM migration_593_scenario_steps_template_refs_backup b WHERE b.id=scenario_steps.id) WHERE id IN (SELECT id FROM migration_593_scenario_steps_template_refs_backup);
DROP TABLE migration_593_template_versions_backup;
DROP TABLE migration_593_template_references_backup;
DROP TABLE migration_593_template_publish_keys_backup;
DROP TABLE migration_593_auto_replies_template_refs_backup;
DROP TABLE migration_593_scenario_steps_template_refs_backup;
PRAGMA defer_foreign_keys = OFF;
