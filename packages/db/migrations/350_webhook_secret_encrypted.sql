-- #650: 送受信Webhookの secret を暗号化して保存する。
-- 平文の secret 列は後方互換のため残し、新規・更新時は secret_encrypted 列へ
-- AES-GCM で暗号化して保存し、secret 列には平文を残さない。
-- 既存の平文は読み取り時にそのまま使えるが、再保存時に暗号化へ移行する。
-- 平文列の廃止は、暗号化の行き渡り確認後に別の票で行う。
ALTER TABLE incoming_webhooks ADD COLUMN secret_encrypted TEXT;
ALTER TABLE outgoing_webhooks ADD COLUMN secret_encrypted TEXT;
