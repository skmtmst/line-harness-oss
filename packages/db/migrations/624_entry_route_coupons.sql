-- オーナー承認 2026-10-10: 流入経路のクーポン QR。
ALTER TABLE entry_routes ADD COLUMN coupon_asset_id TEXT REFERENCES broadcast_message_assets(id) ON DELETE SET NULL;
ALTER TABLE entry_routes ADD COLUMN coupon_enabled INTEGER NOT NULL DEFAULT 0 CHECK (coupon_enabled IN (0, 1));
ALTER TABLE entry_routes ADD COLUMN coupon_audience TEXT NOT NULL DEFAULT 'new_friends' CHECK (coupon_audience IN ('new_friends', 'all_friends'));

-- 経路・素材を消しても受け取りと使用の履歴を残す。1人1回は経路ごと。
CREATE TABLE entry_route_coupon_receipts (
  id TEXT PRIMARY KEY,
  entry_route_id TEXT NOT NULL REFERENCES entry_routes(id),
  asset_id TEXT NOT NULL,
  friend_id TEXT NOT NULL REFERENCES friends(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'received', 'sent', 'failed', 'unknown')),
  asset_name TEXT NOT NULL,
  payload_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  received_at TEXT,
  UNIQUE (entry_route_id, friend_id)
);
CREATE INDEX idx_entry_coupon_receipts_asset_friend ON entry_route_coupon_receipts(asset_id, friend_id, received_at);
ALTER TABLE coupon_redemptions ADD COLUMN entry_route_coupon_receipt_id TEXT REFERENCES entry_route_coupon_receipts(id);
CREATE INDEX idx_coupon_redemptions_receipt ON coupon_redemptions(entry_route_coupon_receipt_id);
