-- N-365 (#746): 受信Webhookの同じ署名の使い回しを弾く。
--
-- 受信の署名は本文だけで作られているため、盗った署名をそのまま送り直すと
-- 何度でも通り、受信行動・イベント発火が繰り返し走っていた
-- (棚卸し #264 の実測: 同一署名3回で 200 が3回・fireEvent が3回)。
-- 本文を変えると 401 になるので完全性は守られていて、欠けているのは新鮮さだけ。
--
-- 署名検証を通った受信を1件ずつ予約し、`INSERT OR IGNORE` の changes=1 を
-- 得た呼び出しだけが下流へ進む。この家の既定の形(migration 358・380 ほか)。
--
-- signature_hash には署名そのものではなく SHA-256 を入れる。
-- 台帳を読めても、そのまま使い回せる署名が残らないようにする。

CREATE TABLE IF NOT EXISTS incoming_webhook_receipts (
  webhook_id     TEXT NOT NULL REFERENCES incoming_webhooks(id) ON DELETE CASCADE,
  signature_hash TEXT NOT NULL,
  received_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (webhook_id, signature_hash)
);

-- 古い受領記録の掃除で、保持期間より古い行を拾うため。
CREATE INDEX IF NOT EXISTS idx_incoming_webhook_receipts_received
  ON incoming_webhook_receipts (received_at);
