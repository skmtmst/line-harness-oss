-- LINE公式アカウント同士の親・子・孫構成と、ログインユーザーの表示範囲。
-- 既存ユーザーは assigned_line_account_id = NULL のまま全アカウントを閲覧できるため、
-- マイグレーション直後に管理画面から締め出されることはない。
ALTER TABLE line_accounts
  ADD COLUMN parent_line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_line_accounts_parent
  ON line_accounts(parent_line_account_id);

ALTER TABLE staff_members
  ADD COLUMN assigned_line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL;

ALTER TABLE staff_members
  ADD COLUMN can_access_descendant_accounts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_staff_members_assigned_line_account
  ON staff_members(assigned_line_account_id);
