-- N-365 (#746): 受信Webhookの同じ署名の使い回しを弾く。
--
-- 受信の署名は本文だけで作られているため、盗った署名をそのまま送り直すと
-- 何度でも通り、受信行動・イベント発火が繰り返し走っていた
-- (棚卸し #264 の実測: 同一署名3回で 200 が3回・fireEvent が3回)。
-- 本文を変えると 401 になるので完全性は守られていて、欠けているのは新鮮さだけ。
--
-- 同一受信を安定したイベントIDへ結び、期限付き所有権で1件ずつ処理する。
-- 完了だけを重複成功として扱い、失敗・所有権期限切れは正規再送で再開する。
--
-- signature_hash には署名そのものではなく SHA-256 を入れる。
-- 台帳を読めても、そのまま使い回せる署名が残らないようにする。

CREATE TABLE IF NOT EXISTS incoming_webhook_receipts (
  webhook_id     TEXT NOT NULL REFERENCES incoming_webhooks(id) ON DELETE CASCADE,
  signature_hash TEXT NOT NULL,
  source_event_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','processing','completed','retryable_failed')),
  lease_owner TEXT,
  lease_expires_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  last_error_code TEXT,
  received_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (webhook_id, signature_hash)
);

-- 古い受領記録の掃除で、保持期間より古い行を拾うため。
CREATE INDEX IF NOT EXISTS idx_incoming_webhook_receipts_received
  ON incoming_webhook_receipts (received_at);

-- 成功した行動は再実行しない。本文は保持せず、結果の要約だけを保存する。
CREATE TABLE IF NOT EXISTS incoming_webhook_steps (
  source_event_id TEXT NOT NULL REFERENCES incoming_webhook_receipts(source_event_id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing','completed')),
  result_json TEXT,
  PRIMARY KEY (source_event_id, step_key)
);
