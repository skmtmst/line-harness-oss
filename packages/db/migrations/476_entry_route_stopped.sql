-- M (止めた流入経路の QR): 経路を止めた時刻と理由を残す。
--
-- 止めた経路は QR・印刷を出さない。QRダイアログで「この経路は停止しています」
-- と出すとき、いつ止めたか・なぜ止めたかも見せるための欄。
-- 新しく止めるときに受付停止の操作が入れる。既存の停止行は NULL のままにし、
-- 推測で埋めない(is_active=0 が停止の印であることは変わらない)。

ALTER TABLE entry_routes ADD COLUMN stopped_at TEXT;

ALTER TABLE entry_routes ADD COLUMN stopped_reason TEXT;
