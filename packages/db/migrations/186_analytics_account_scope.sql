-- V6分析は通常画面で複数のLINE公式アカウントを混ぜない。
-- 旧ファネルは所属を推測できないためNULLのまま残し、新しいAPIでは表示しない。
ALTER TABLE funnels ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_funnels_line_account_created
  ON funnels(line_account_id, created_at DESC);
