-- M (止めた流入経路の QR): アカウント×受付状態の索引。
--
-- QRダイアログの経路一覧と、止めた経路の判定が
-- 「LINEアカウント×is_active」で絞り込むための索引。476 と合わせて使う。

CREATE INDEX IF NOT EXISTS idx_entry_routes_account_active
  ON entry_routes(line_account_id, is_active);
