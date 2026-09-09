-- Issue #686: アフィリエイター登録・案件登録の作成(POST)が commit 後の
-- 応答喪失で再送されても、同じ登録を回収できるようにする。
--
-- 安定した操作UUID(operation_id)を (tenant/account, operation_id) の
-- 一意制約で受け、衝突時は新規作成せず既存行を返す。318番の支払い
-- operations(idempotency_key + UNIQUE)と同じ compare-and-swap 型の冪等。

ALTER TABLE affiliates ADD COLUMN operation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliates_operation_id
  ON affiliates(tenant_id, line_account_id, operation_id)
  WHERE operation_id IS NOT NULL;

ALTER TABLE affiliate_offers ADD COLUMN operation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_offers_operation_id
  ON affiliate_offers(line_account_id, operation_id)
  WHERE operation_id IS NOT NULL;
