-- migration-policy: table-rebuild
--
-- F-13（自動化と外部連携）の置き場の種類を増やす。'common_action'、
-- 'webhook'、'conversion' の3つを足す。'automation' は前からある。
--
-- `folders.kind` は CHECK なので、値を足すだけでも表を作り直すしかない
-- （150 のやり方をなぞる）。落とすのと改名するのは同じファイルに書く。
-- 分けると、その間に止まったときに `folders` が存在しない状態で残る。
--
-- 中身（自動化・共通操作・webhook・変換）の `folder_id` 列はまだ無い。
-- 箱の種類だけ先に足し、中身のひも付けと件数は別 lemma でやる。
-- それまでは件数は「数えていない」（#730）で返る。
--
-- ついでに直るもの: 'friend_field' は code（folders.ts）に前からあるのに
-- CHECK には入っていなかった。今回の作り直しで code と一致する。
--
-- #1269: D1 では外部キーが有効なので、ただ落とすと暗黙の削除が走り、
-- 子の表の folder_id が ON DELETE SET NULL で全部 NULL になる。
-- 落とす前に子の (id, folder_id) を退避し、作り直した後に戻す。
-- 退避表は最後に落とす。適用はしないこと（PR 本文に番号だけ書く）。
CREATE TABLE _556_folders_backup_templates (id TEXT PRIMARY KEY, folder_id TEXT);
INSERT INTO _556_folders_backup_templates (id, folder_id) SELECT id, folder_id FROM templates;
CREATE TABLE _556_folders_backup_scenarios (id TEXT PRIMARY KEY, folder_id TEXT);
INSERT INTO _556_folders_backup_scenarios (id, folder_id) SELECT id, folder_id FROM scenarios;
CREATE TABLE _556_folders_backup_auto_replies (id TEXT PRIMARY KEY, folder_id TEXT);
INSERT INTO _556_folders_backup_auto_replies (id, folder_id) SELECT id, folder_id FROM auto_replies;
CREATE TABLE _556_folders_backup_reminders (id TEXT PRIMARY KEY, folder_id TEXT);
INSERT INTO _556_folders_backup_reminders (id, folder_id) SELECT id, folder_id FROM reminders;
CREATE TABLE _556_folders_backup_tags (id TEXT PRIMARY KEY, folder_id TEXT);
INSERT INTO _556_folders_backup_tags (id, folder_id) SELECT id, folder_id FROM tags;
CREATE TABLE _556_folders_backup_friend_fields (id TEXT PRIMARY KEY, folder_id TEXT);
INSERT INTO _556_folders_backup_friend_fields (id, folder_id) SELECT id, folder_id FROM friend_fields;
CREATE TABLE _556_folders_backup_media (id TEXT PRIMARY KEY, folder_id TEXT);
INSERT INTO _556_folders_backup_media (id, folder_id) SELECT id, folder_id FROM media;
CREATE TABLE _556_folders_backup_common_vars (id TEXT PRIMARY KEY, folder_id TEXT);
INSERT INTO _556_folders_backup_common_vars (id, folder_id) SELECT id, folder_id FROM common_vars;
CREATE TABLE _556_folders_backup_broadcasts (id TEXT PRIMARY KEY, folder_id TEXT);
INSERT INTO _556_folders_backup_broadcasts (id, folder_id) SELECT id, folder_id FROM broadcasts;
CREATE TABLE _556_folders_backup_rich_menu_groups (id TEXT PRIMARY KEY, folder_id TEXT);
INSERT INTO _556_folders_backup_rich_menu_groups (id, folder_id) SELECT id, folder_id FROM rich_menu_groups;
CREATE TABLE _556_folders_backup_webinars (id TEXT PRIMARY KEY, folder_id TEXT);
INSERT INTO _556_folders_backup_webinars (id, folder_id) SELECT id, folder_id FROM webinars;
CREATE TABLE _556_folders_backup_media_upload_sessions (id TEXT PRIMARY KEY, folder_id TEXT);
INSERT INTO _556_folders_backup_media_upload_sessions (id, folder_id) SELECT id, folder_id FROM media_upload_sessions;
CREATE TABLE _556_folders_backup_forms (id TEXT PRIMARY KEY, folder_id TEXT);
INSERT INTO _556_folders_backup_forms (id, folder_id) SELECT id, folder_id FROM forms;

CREATE TABLE folders_new (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'tag','template','scenario','reminder','auto_reply',
                  'rich_menu','webinar','form','media','common_var',
                  'mileage_rule','automation','event','entry_route','broadcast',
                  'friend_field','common_action','webhook','conversion')),
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES folders(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  color         TEXT,
  account_id    TEXT REFERENCES line_accounts(id) ON DELETE CASCADE
);

-- 中身は全部引き継ぐ（account_id・color を含む9列を全部写す）。
INSERT INTO folders_new (id, kind, name, parent_id, display_order, created_at, updated_at, color, account_id)
SELECT id, kind, name, parent_id, display_order, created_at, updated_at, color, account_id FROM folders;

DROP TABLE folders;
ALTER TABLE folders_new RENAME TO folders;

-- 索引を貼り直す。名前は毎回変えること（150 の注意書き）。
-- 落とす前の状態を見て「もうある」と判断されると飛ばされて戻らない（136）。
CREATE INDEX IF NOT EXISTS idx_folders_kind_order_556 ON folders(kind, display_order);

-- 333 の索引は表と一緒に消えるので、同じ中身で貼り直す。
CREATE INDEX IF NOT EXISTS idx_folders_webinar_account_order_556
  ON folders(kind, account_id, display_order, name);

-- 退避した子のひも付けを戻す。置き場の id は変えていないので、そのまま戻る。
UPDATE templates SET folder_id = (SELECT folder_id FROM _556_folders_backup_templates WHERE _556_folders_backup_templates.id = templates.id)
  WHERE EXISTS (SELECT 1 FROM _556_folders_backup_templates WHERE _556_folders_backup_templates.id = templates.id);
UPDATE scenarios SET folder_id = (SELECT folder_id FROM _556_folders_backup_scenarios WHERE _556_folders_backup_scenarios.id = scenarios.id)
  WHERE EXISTS (SELECT 1 FROM _556_folders_backup_scenarios WHERE _556_folders_backup_scenarios.id = scenarios.id);
UPDATE auto_replies SET folder_id = (SELECT folder_id FROM _556_folders_backup_auto_replies WHERE _556_folders_backup_auto_replies.id = auto_replies.id)
  WHERE EXISTS (SELECT 1 FROM _556_folders_backup_auto_replies WHERE _556_folders_backup_auto_replies.id = auto_replies.id);
UPDATE reminders SET folder_id = (SELECT folder_id FROM _556_folders_backup_reminders WHERE _556_folders_backup_reminders.id = reminders.id)
  WHERE EXISTS (SELECT 1 FROM _556_folders_backup_reminders WHERE _556_folders_backup_reminders.id = reminders.id);
UPDATE tags SET folder_id = (SELECT folder_id FROM _556_folders_backup_tags WHERE _556_folders_backup_tags.id = tags.id)
  WHERE EXISTS (SELECT 1 FROM _556_folders_backup_tags WHERE _556_folders_backup_tags.id = tags.id);
UPDATE friend_fields SET folder_id = (SELECT folder_id FROM _556_folders_backup_friend_fields WHERE _556_folders_backup_friend_fields.id = friend_fields.id)
  WHERE EXISTS (SELECT 1 FROM _556_folders_backup_friend_fields WHERE _556_folders_backup_friend_fields.id = friend_fields.id);
UPDATE media SET folder_id = (SELECT folder_id FROM _556_folders_backup_media WHERE _556_folders_backup_media.id = media.id)
  WHERE EXISTS (SELECT 1 FROM _556_folders_backup_media WHERE _556_folders_backup_media.id = media.id);
UPDATE common_vars SET folder_id = (SELECT folder_id FROM _556_folders_backup_common_vars WHERE _556_folders_backup_common_vars.id = common_vars.id)
  WHERE EXISTS (SELECT 1 FROM _556_folders_backup_common_vars WHERE _556_folders_backup_common_vars.id = common_vars.id);
UPDATE broadcasts SET folder_id = (SELECT folder_id FROM _556_folders_backup_broadcasts WHERE _556_folders_backup_broadcasts.id = broadcasts.id)
  WHERE EXISTS (SELECT 1 FROM _556_folders_backup_broadcasts WHERE _556_folders_backup_broadcasts.id = broadcasts.id);
UPDATE rich_menu_groups SET folder_id = (SELECT folder_id FROM _556_folders_backup_rich_menu_groups WHERE _556_folders_backup_rich_menu_groups.id = rich_menu_groups.id)
  WHERE EXISTS (SELECT 1 FROM _556_folders_backup_rich_menu_groups WHERE _556_folders_backup_rich_menu_groups.id = rich_menu_groups.id);
UPDATE webinars SET folder_id = (SELECT folder_id FROM _556_folders_backup_webinars WHERE _556_folders_backup_webinars.id = webinars.id)
  WHERE EXISTS (SELECT 1 FROM _556_folders_backup_webinars WHERE _556_folders_backup_webinars.id = webinars.id);
UPDATE media_upload_sessions SET folder_id = (SELECT folder_id FROM _556_folders_backup_media_upload_sessions WHERE _556_folders_backup_media_upload_sessions.id = media_upload_sessions.id)
  WHERE EXISTS (SELECT 1 FROM _556_folders_backup_media_upload_sessions WHERE _556_folders_backup_media_upload_sessions.id = media_upload_sessions.id);
UPDATE forms SET folder_id = (SELECT folder_id FROM _556_folders_backup_forms WHERE _556_folders_backup_forms.id = forms.id)
  WHERE EXISTS (SELECT 1 FROM _556_folders_backup_forms WHERE _556_folders_backup_forms.id = forms.id);

DROP TABLE _556_folders_backup_templates;
DROP TABLE _556_folders_backup_scenarios;
DROP TABLE _556_folders_backup_auto_replies;
DROP TABLE _556_folders_backup_reminders;
DROP TABLE _556_folders_backup_tags;
DROP TABLE _556_folders_backup_friend_fields;
DROP TABLE _556_folders_backup_media;
DROP TABLE _556_folders_backup_common_vars;
DROP TABLE _556_folders_backup_broadcasts;
DROP TABLE _556_folders_backup_rich_menu_groups;
DROP TABLE _556_folders_backup_webinars;
DROP TABLE _556_folders_backup_media_upload_sessions;
DROP TABLE _556_folders_backup_forms;
