-- 保存した検索を選択中のLINE公式アカウントへ閉じる。
-- 既存行は帰属を推測せずNULLのまま残す。誤ったアカウントへ公開するより、
-- 管理者が確認してから割り当てる方が安全なため。
ALTER TABLE saved_searches ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_saved_searches_account_scope
  ON saved_searches(line_account_id, scope, created_by, display_order);
