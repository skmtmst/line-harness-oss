-- S (#939 機能26): 受信Webhookの合言葉の入れ替えに24時間の併用期間を持たせる。
--
-- 合言葉を入れ替えた直後、相手のサービス側の切り替えが終わるまで
-- 前の合言葉で署名された届物も受け付ける。前の合言葉は暗号文のまま
-- secret_previous_encrypted に移し、入れ替え時刻を secret_rotated_at に残す。
-- 併用は入れ替えから24時間だけ。期限を過ぎた古い合言葉の届物は拒否する。

ALTER TABLE incoming_webhooks ADD COLUMN secret_previous_encrypted TEXT;
ALTER TABLE incoming_webhooks ADD COLUMN secret_rotated_at TEXT;
