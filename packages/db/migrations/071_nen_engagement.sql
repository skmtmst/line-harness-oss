-- NEN専用の購入後フォロー・コラム・誕生日クーポン配信。
-- 汎用シナリオとは分離し、ECイベント単位の冪等性を保証する。
CREATE TABLE IF NOT EXISTS nen_campaign_settings (
  campaign_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('transactional', 'follow_up', 'column', 'birthday')),
  trigger_event TEXT,
  delay_days INTEGER NOT NULL DEFAULT 0 CHECK (delay_days BETWEEN 0 AND 365),
  delivery_time TEXT NOT NULL DEFAULT '10:00',
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  title TEXT NOT NULL,
  body_text TEXT NOT NULL DEFAULT '',
  button_label TEXT,
  button_url TEXT,
  image_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO nen_campaign_settings
  (campaign_key, label, category, trigger_event, delay_days, delivery_time, is_enabled, title, body_text, button_label, button_url, created_at, updated_at)
VALUES
  ('order_confirmed', '注文完了', 'transactional', 'ec.order.confirmed', 0, '10:00', 1,
   'ご注文ありがとうございます', 'ご注文を承りました。内容をご確認ください。', '注文内容を確認する', 'https://stg.nen-petfood.com/mypage', datetime('now'), datetime('now')),
  ('shipping_confirmed', '発送完了', 'transactional', 'ec.order.shipped', 0, '10:00', 1,
   '商品を発送しました', '然-NEN-の商品を発送しました。到着まで今しばらくお待ちください。', '配送状況を確認する', 'https://stg.nen-petfood.com/mypage', datetime('now'), datetime('now')),
  ('arrival_check', '商品到着の確認', 'follow_up', 'ec.order.shipped', 5, '10:00', 1,
   '商品は無事に届きましたか？', '発送から数日が経ちました。商品が無事に届いているか確認させてください。', '注文内容を確認する', 'https://stg.nen-petfood.com/mypage', datetime('now'), datetime('now')),
  ('review_request', '使用感・口コミのお願い', 'follow_up', 'ec.order.shipped', 10, '10:00', 1,
   '実際に使ってみていかがでしたか？', '愛犬・愛猫の様子や商品のご感想を、ぜひお聞かせください。いただいた声を今後の商品づくりに活かします。', '口コミを投稿する', 'https://stg.nen-petfood.com/products/list', datetime('now'), datetime('now')),
  ('cross_sell', '他の商品・定期便のご案内', 'follow_up', 'ec.order.shipped', 14, '10:00', 1,
   '毎日のごはんを、もっと安心で手軽に', '然-NEN-には、素材や食べ方に合わせた商品と、お得で続けやすい定期便があります。', '商品・定期便を見る', 'https://stg.nen-petfood.com/products/list', datetime('now'), datetime('now')),
  ('column', 'NENコラム', 'column', NULL, 0, '10:00', 1,
   'NENコラムを更新しました', 'ジビエ、ペットフード、愛犬・愛猫の健康についてお届けします。', 'コラムを読む', 'https://stg.nen-petfood.com/journal', datetime('now'), datetime('now')),
  ('birthday_coupon', 'お誕生日クーポン', 'birthday', NULL, 0, '10:00', 1,
   '{{pet_name}}ちゃん、お誕生日月おめでとうございます', '大切なお誕生日月をお祝いして、然-NEN-から特別なクーポンをお届けします。', 'クーポンを使う', 'https://stg.nen-petfood.com/products/list', datetime('now'), datetime('now'));

CREATE TABLE IF NOT EXISTS nen_delivery_jobs (
  id TEXT PRIMARY KEY,
  campaign_key TEXT NOT NULL REFERENCES nen_campaign_settings(campaign_key),
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id TEXT,
  source_key TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'skipped', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (campaign_key, friend_id, source_key)
);

CREATE INDEX IF NOT EXISTS idx_nen_delivery_jobs_due
  ON nen_delivery_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_nen_delivery_jobs_friend
  ON nen_delivery_jobs(friend_id, created_at DESC);

CREATE TABLE IF NOT EXISTS nen_columns (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT,
  excerpt TEXT NOT NULL DEFAULT '',
  article_url TEXT NOT NULL,
  image_url TEXT,
  published_at TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'draft' CHECK (delivery_status IN ('draft', 'scheduled', 'queued', 'sent')),
  delivery_at TEXT,
  line_account_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nen_pet_profiles (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  customer_id TEXT,
  name TEXT NOT NULL,
  animal_type TEXT NOT NULL DEFAULT 'dog' CHECK (animal_type IN ('dog', 'cat', 'other')),
  gender TEXT NOT NULL DEFAULT 'unknown' CHECK (gender IN ('male', 'female', 'unknown')),
  birthday TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nen_pet_profiles_birthday
  ON nen_pet_profiles(substr(birthday, 6, 2), friend_id);
CREATE INDEX IF NOT EXISTS idx_nen_pet_profiles_customer
  ON nen_pet_profiles(customer_id);

CREATE TABLE IF NOT EXISTS nen_birthday_coupon_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  code_prefix TEXT NOT NULL DEFAULT 'NENBDAY',
  benefit_label TEXT NOT NULL DEFAULT 'お誕生日月限定クーポン',
  discount_amount INTEGER NOT NULL DEFAULT 500 CHECK (discount_amount BETWEEN 1 AND 100000),
  validity_days INTEGER NOT NULL DEFAULT 31 CHECK (validity_days BETWEEN 1 AND 365),
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO nen_birthday_coupon_settings
  (id, is_enabled, code_prefix, benefit_label, discount_amount, validity_days, updated_at)
VALUES ('default', 1, 'NENBDAY', 'お誕生日月限定クーポン', 500, 31, datetime('now'));

CREATE TABLE IF NOT EXISTS nen_coupon_issues (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES nen_pet_profiles(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  issue_year INTEGER NOT NULL,
  coupon_code TEXT NOT NULL UNIQUE,
  benefit_label TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  used_at TEXT,
  UNIQUE (pet_id, issue_year)
);
