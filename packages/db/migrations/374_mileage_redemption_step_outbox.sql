-- 交換の配送手順ごとの送信記録(#641)。
-- 外部送信(クーポン以外の特典動作)のあと確定書き込みが失敗しても、
-- やり直しで同じ手順を再送しないための outbox。手順キーは
-- deliver 側の安定キー(番号:動作ID)で、冪等キーと対にして残す。
CREATE TABLE IF NOT EXISTS mileage_redemption_step_deliveries (
  redemption_id   TEXT NOT NULL REFERENCES mileage_redemptions(id),
  step_key        TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'started'
                    CHECK (status IN ('started', 'sent')),
  attempt_count   INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (redemption_id, step_key)
);

CREATE TRIGGER IF NOT EXISTS trg_mileage_redemption_step_deliveries_no_delete
BEFORE DELETE ON mileage_redemption_step_deliveries
BEGIN SELECT RAISE(ABORT, 'mileage redemption step delivery history cannot be deleted'); END;
