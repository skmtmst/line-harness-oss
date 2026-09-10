-- EC受信の購読先別配送台帳。LINE通知とV6連携の成否を分け、
-- 成功先を保ったまま失敗先だけ再試行する。冪等キーは発生元の安定ID
-- (`eccube:<アカウント>:<出来事ID>:<購読先>`)から作り、再送・再試行で変わらない。
CREATE TABLE IF NOT EXISTS ec_v6_dispatches (
  event_id        TEXT NOT NULL REFERENCES ec_events(id) ON DELETE CASCADE,
  subscriber      TEXT NOT NULL CHECK (subscriber IN ('notification', 'v6')),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  idempotency_key TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (event_id, subscriber)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ec_v6_dispatches_idempotency
  ON ec_v6_dispatches (idempotency_key);
