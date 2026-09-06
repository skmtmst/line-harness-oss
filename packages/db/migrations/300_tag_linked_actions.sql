-- V6 機能4: タグ定義の認可・楽観ロック・共通アクション連動。
--
-- アクション本体は 181 の common_actions / common_action_versions に保存する。
-- タグ専用の実行テーブルは作らない。

ALTER TABLE tags ADD COLUMN description TEXT;
ALTER TABLE tags ADD COLUMN normalized_name TEXT;
ALTER TABLE tags ADD COLUMN manual_assignment_allowed INTEGER NOT NULL DEFAULT 1
  CHECK (manual_assignment_allowed IN (0, 1));
ALTER TABLE tags ADD COLUMN reapply_policy TEXT NOT NULL DEFAULT 'first_only'
  CHECK (reapply_policy IN ('first_only', 'every_time'));
ALTER TABLE tags ADD COLUMN linked_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (linked_enabled IN (0, 1));
ALTER TABLE tags ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'));
ALTER TABLE tags ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE tags ADD COLUMN created_by TEXT;
ALTER TABLE tags ADD COLUMN updated_by TEXT;
ALTER TABLE tags ADD COLUMN updated_at TEXT;

UPDATE tags SET updated_at = created_at WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tags_account_status_name
  ON tags(line_account_id, status, name, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_account_normalized_name
  ON tags(line_account_id, normalized_name)
  WHERE line_account_id IS NOT NULL AND normalized_name IS NOT NULL;
