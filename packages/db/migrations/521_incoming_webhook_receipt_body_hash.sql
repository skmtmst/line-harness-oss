-- R425: 合言葉の入れ替え後に同じ通知を再署名しても、受信処理と後続通知を重ねない。
--
-- 受信の署名は本文だけで作られているため、合言葉の切り替え後に同じ業務通知を
-- 再送すると署名が変わり、別の受領・未照合・後続通知になっていた。
-- 本文のハッシュも受領行へ残し、同じ接続・本文の再送は署名が変わっても
-- 同じ受領へ結び付ける。本文が違う正当な通知は別受領のまま。
-- 付け足すだけ（既存の列・行は今の動き。旧行の body_hash は NULL のまま）。

ALTER TABLE incoming_webhook_receipts ADD COLUMN body_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_incoming_webhook_receipts_body
  ON incoming_webhook_receipts (webhook_id, body_hash);
