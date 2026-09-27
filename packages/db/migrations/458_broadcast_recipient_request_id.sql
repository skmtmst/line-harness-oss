-- 458: 一斉配信の宛先台帳に LINE の要求 ID を足す（#816）。
-- 付け足すだけ。既存の列を消さない・型を変えない。
--
-- multicast / push の応答ヘッダー（x-line-request-id）を、送った束の
-- 宛先行に写す。応答に無いときは NULL のまま残し、代わりの値を作らない。
-- 画面は NULL を「—」と出す。
ALTER TABLE broadcast_send_claims ADD COLUMN line_request_id TEXT;
