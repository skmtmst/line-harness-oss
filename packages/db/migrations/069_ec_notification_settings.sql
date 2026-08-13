-- EC transactional notification controls for the NEN admin dashboard.
CREATE TABLE IF NOT EXISTS ec_notification_settings (
  event_type TEXT PRIMARY KEY,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  title_override TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO ec_notification_settings (event_type, is_enabled, title_override, created_at, updated_at) VALUES
  ('ec.order.confirmed', 1, 'ご注文ありがとうございます', datetime('now'), datetime('now')),
  ('ec.order.shipped', 1, '商品を発送しました', datetime('now'), datetime('now')),
  ('ec.subscription.upcoming', 1, '次回の定期便をお知らせします', datetime('now'), datetime('now')),
  ('ec.subscription.payment_failed', 1, '定期便のお支払いをご確認ください', datetime('now'), datetime('now')),
  ('ec.subscription.cancelled', 1, '定期便の解約を受け付けました', datetime('now'), datetime('now'));
