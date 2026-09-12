-- 交換配送の手順outboxに貸出(owner・期限・世代・fence)を足す(#1464 差し戻し)。
-- started のまま残った行を別runnerが無条件で送り直すと、冪等でない受信先へ
-- 二重に届く。外部送信のあと確定に失敗した手順は送達不明(needs_reconcile=1)
-- として送り直さず、同じ冪等キーで照合して確定だけ進める。
ALTER TABLE mileage_redemption_step_deliveries ADD COLUMN owner TEXT;
ALTER TABLE mileage_redemption_step_deliveries ADD COLUMN lease_expires_at TEXT;
ALTER TABLE mileage_redemption_step_deliveries ADD COLUMN generation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mileage_redemption_step_deliveries ADD COLUMN fence_token TEXT;
ALTER TABLE mileage_redemption_step_deliveries ADD COLUMN needs_reconcile INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_mileage_step_deliveries_reconcile
  ON mileage_redemption_step_deliveries (needs_reconcile, lease_expires_at);
