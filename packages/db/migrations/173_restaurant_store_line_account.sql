-- 1店舗につき1つのLINE公式アカウントを割り当てる。
-- 既存店舗は移行中のためNULLを許容し、必須制約はアプリ層で担保する。
ALTER TABLE rt_stores ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rt_stores_line_account
  ON rt_stores (line_account_id) WHERE line_account_id IS NOT NULL;
