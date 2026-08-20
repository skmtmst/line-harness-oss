-- 注文・入金・発送・定期便のLINE通知を1か所で管理する。
-- 既存のNEN配信にあった注文完了・発送完了は、文面を引き継いでこちらへ移す。
ALTER TABLE ec_notification_settings ADD COLUMN category TEXT NOT NULL DEFAULT 'order';
ALTER TABLE ec_notification_settings ADD COLUMN button_label TEXT;
ALTER TABLE ec_notification_settings ADD COLUMN button_url TEXT;
ALTER TABLE ec_notification_settings ADD COLUMN image_url TEXT;
ALTER TABLE ec_notification_settings ADD COLUMN display_order INTEGER NOT NULL DEFAULT 100;

UPDATE ec_notification_settings
   SET category = CASE event_type
     WHEN 'ec.order.shipped' THEN 'shipping'
     WHEN 'ec.subscription.upcoming' THEN 'subscription'
     WHEN 'ec.subscription.payment_failed' THEN 'subscription'
     WHEN 'ec.subscription.cancelled' THEN 'subscription'
     ELSE 'order'
   END,
       display_order = CASE event_type
     WHEN 'ec.order.confirmed' THEN 10
     WHEN 'ec.order.shipped' THEN 40
     WHEN 'ec.subscription.upcoming' THEN 70
     WHEN 'ec.subscription.payment_failed' THEN 80
     WHEN 'ec.subscription.cancelled' THEN 110
     ELSE 100
   END;

UPDATE ec_notification_settings
   SET title_override = COALESCE((SELECT title FROM nen_campaign_settings WHERE campaign_key = 'order_confirmed'), title_override),
       intro_text = COALESCE((SELECT body_text FROM nen_campaign_settings WHERE campaign_key = 'order_confirmed'), intro_text),
       button_label = (SELECT button_label FROM nen_campaign_settings WHERE campaign_key = 'order_confirmed'),
       button_url = (SELECT button_url FROM nen_campaign_settings WHERE campaign_key = 'order_confirmed'),
       image_url = (SELECT image_url FROM nen_campaign_settings WHERE campaign_key = 'order_confirmed')
 WHERE event_type = 'ec.order.confirmed';

UPDATE ec_notification_settings
   SET title_override = COALESCE((SELECT title FROM nen_campaign_settings WHERE campaign_key = 'shipping_confirmed'), title_override),
       intro_text = COALESCE((SELECT body_text FROM nen_campaign_settings WHERE campaign_key = 'shipping_confirmed'), intro_text),
       button_label = (SELECT button_label FROM nen_campaign_settings WHERE campaign_key = 'shipping_confirmed'),
       button_url = (SELECT button_url FROM nen_campaign_settings WHERE campaign_key = 'shipping_confirmed'),
       image_url = (SELECT image_url FROM nen_campaign_settings WHERE campaign_key = 'shipping_confirmed')
 WHERE event_type = 'ec.order.shipped';

INSERT OR IGNORE INTO ec_notification_settings
  (event_type, is_enabled, title_override, intro_text, outro_text, category, button_label, button_url, image_url, display_order, created_at, updated_at)
VALUES
  ('ec.order.payment_received', 1, 'ご入金を確認いたしました', 'お振込みいただき、誠にありがとうございます。ご入金を確認いたしました。', '発送準備が整い次第、改めてご案内いたします。', 'payment', '注文内容を確認する', NULL, NULL, 20, datetime('now'), datetime('now')),
  ('ec.order.bank_transfer_reminder', 1, '銀行振込期限のご案内', 'ご注文のお支払い期限が近づいております。', 'すでにお振込み済みの場合は、行き違いとなりましたことをご容赦ください。', 'payment', '注文内容を確認する', NULL, NULL, 30, datetime('now'), datetime('now')),
  ('ec.order.cancelled', 1, 'ご注文のキャンセルを承りました', 'ご注文のキャンセル手続きが完了いたしました。', 'またのご利用を心よりお待ちしております。', 'support', '注文内容を確認する', NULL, NULL, 50, datetime('now'), datetime('now')),
  ('ec.order.refunded', 1, '返金手続きが完了しました', 'ご注文の返金手続きが完了いたしました。', '金融機関により反映まで数日かかる場合がございます。', 'support', '注文内容を確認する', NULL, NULL, 60, datetime('now'), datetime('now')),
  ('ec.subscription.card_updated', 1, 'カード変更・再決済結果のご案内', '定期便のお支払いカードを変更し、再決済結果を確認いたしました。', '次回のお支払い予定をご確認ください。', 'subscription', '定期便を確認する', NULL, NULL, 90, datetime('now'), datetime('now'));

UPDATE nen_campaign_settings
   SET is_enabled = 0, updated_at = datetime('now')
 WHERE campaign_key IN ('order_confirmed', 'shipping_confirmed');
