-- 自動タグ導入時の既存ユーザー向け初回同期。
-- 日々の付与・解除は Worker の nen-tag-sync.ts が担う。このSQLは何度実行しても重複しない。

-- LINEで友だちになっている会員の共通タグ。
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT id, 'nen-tag-member-nen', datetime('now') FROM friends
WHERE is_following = 1 AND user_id IS NOT NULL AND user_id <> '';
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT id, 'nen-tag-member-line-linked', datetime('now') FROM friends
WHERE is_following = 1 AND user_id IS NOT NULL AND user_id <> '';

-- 配信停止希望が付いていない会員は、各NEN配信の対象候補とする。
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT f.id, t.id, datetime('now')
FROM friends f
JOIN tags t ON t.id IN (
  'nen-tag-delivery-order','nen-tag-delivery-shipped','nen-tag-delivery-arrival',
  'nen-tag-delivery-review','nen-tag-delivery-recommendation','nen-tag-delivery-column',
  'nen-tag-delivery-birthday'
)
WHERE f.is_following = 1 AND f.user_id IS NOT NULL AND f.user_id <> ''
  AND NOT EXISTS (
    SELECT 1 FROM friend_tags stop
    WHERE stop.friend_id = f.id AND stop.tag_id = 'nen-tag-delivery-optout'
  );

-- EC連携・会員ランク。
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT friend_id, 'nen-tag-member-ec-linked', datetime('now')
FROM nen_ec_member_snapshots WHERE customer_id IS NOT NULL AND customer_id <> '';
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT id, 'nen-tag-member-ec-linked', datetime('now') FROM friends
WHERE is_following = 1 AND user_id IS NOT NULL AND user_id <> '';

INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT friend_id,
  CASE
    WHEN purchase_amount >= 100000 THEN 'nen-tag-member-rank-platinum'
    WHEN purchase_amount >= 50000 THEN 'nen-tag-member-rank-gold'
    WHEN purchase_amount >= 20000 THEN 'nen-tag-member-rank-silver'
    ELSE 'nen-tag-member-rank-basic'
  END,
  datetime('now')
FROM nen_ec_member_snapshots;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT f.id, 'nen-tag-member-rank-basic', datetime('now')
FROM friends f LEFT JOIN nen_ec_member_snapshots s ON s.friend_id=f.id
WHERE f.is_following=1 AND f.user_id IS NOT NULL AND f.user_id <> '' AND s.friend_id IS NULL;

-- 購入状態と累計金額。未同期のLINE会員は「未購入」とする。
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT f.id, 'nen-tag-purchase-none', datetime('now')
FROM friends f LEFT JOIN nen_ec_member_snapshots s ON s.friend_id = f.id
WHERE f.is_following = 1 AND COALESCE(s.purchase_count, 0) = 0;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT friend_id, 'nen-tag-purchase-first', datetime('now') FROM nen_ec_member_snapshots WHERE purchase_count = 1;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT friend_id, 'nen-tag-purchase-experienced', datetime('now') FROM nen_ec_member_snapshots WHERE purchase_count > 0;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT friend_id, 'nen-tag-purchase-repeat', datetime('now') FROM nen_ec_member_snapshots WHERE purchase_count >= 2;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT friend_id, 'nen-tag-purchase-total-20k', datetime('now') FROM nen_ec_member_snapshots WHERE purchase_amount >= 20000;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT friend_id, 'nen-tag-purchase-total-50k', datetime('now') FROM nen_ec_member_snapshots WHERE purchase_amount >= 50000;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT friend_id, 'nen-tag-purchase-total-100k', datetime('now') FROM nen_ec_member_snapshots WHERE purchase_amount >= 100000;

-- 最終購入日と購入商品。履歴に存在する商品分類は複数タグを併用できる。
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT s.friend_id,
  CASE
    WHEN julianday('now') - julianday(MAX(json_extract(o.value, '$.date'))) <= 30 THEN 'nen-tag-purchase-recent-30'
    WHEN julianday('now') - julianday(MAX(json_extract(o.value, '$.date'))) <= 90 THEN 'nen-tag-purchase-recent-90'
    ELSE 'nen-tag-purchase-dormant'
  END,
  datetime('now')
FROM nen_ec_member_snapshots s, json_each(s.orders_json) o
WHERE json_extract(o.value, '$.date') IS NOT NULL
GROUP BY s.friend_id;

INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT s.friend_id, 'nen-tag-product-mince', datetime('now')
FROM nen_ec_member_snapshots s, json_each(s.orders_json) o, json_each(json_extract(o.value, '$.items')) i
WHERE json_extract(i.value, '$.name') LIKE '%ミンチ%';
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT s.friend_id, 'nen-tag-product-rib', datetime('now')
FROM nen_ec_member_snapshots s, json_each(s.orders_json) o, json_each(json_extract(o.value, '$.items')) i
WHERE json_extract(i.value, '$.name') LIKE '%アバラ骨%' OR json_extract(i.value, '$.name') LIKE '%あばら骨%';
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT s.friend_id, 'nen-tag-product-balance', datetime('now')
FROM nen_ec_member_snapshots s, json_each(s.orders_json) o, json_each(json_extract(o.value, '$.items')) i
WHERE json_extract(i.value, '$.name') LIKE '%鹿肉バランス%';
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT s.friend_id, 'nen-tag-product-treat', datetime('now')
FROM nen_ec_member_snapshots s, json_each(s.orders_json) o, json_each(json_extract(o.value, '$.items')) i
WHERE json_extract(i.value, '$.name') LIKE '%おやつ%' OR json_extract(i.value, '$.name') LIKE '%ジャーキー%';
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT s.friend_id, 'nen-tag-product-set', datetime('now')
FROM nen_ec_member_snapshots s, json_each(s.orders_json) o, json_each(json_extract(o.value, '$.items')) i
WHERE json_extract(i.value, '$.name') LIKE '%セット%';
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT s.friend_id, 'nen-tag-product-trial', datetime('now')
FROM nen_ec_member_snapshots s, json_each(s.orders_json) o, json_each(json_extract(o.value, '$.items')) i
WHERE json_extract(i.value, '$.name') LIKE '%お試し%' OR json_extract(i.value, '$.name') LIKE '%トライアル%';
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT s.friend_id, 'nen-tag-product-subscription', datetime('now')
FROM nen_ec_member_snapshots s, json_each(s.orders_json) o, json_each(json_extract(o.value, '$.items')) i
WHERE json_extract(i.value, '$.name') LIKE '%定期%';
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT s.friend_id, t.id, datetime('now')
FROM nen_ec_member_snapshots s JOIN tags t ON t.id IN ('nen-tag-interest-venison','nen-tag-interest-pet-food')
WHERE json_array_length(s.orders_json) > 0;

-- ペット登録状況・種別・多頭飼い。
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT f.id, 'nen-tag-pet-unregistered', datetime('now')
FROM friends f WHERE f.is_following = 1
  AND NOT EXISTS (SELECT 1 FROM nen_pet_profiles p WHERE p.friend_id = f.id);
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id, 'nen-tag-pet-registered', datetime('now') FROM nen_pet_profiles;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT friend_id, 'nen-tag-pet-multiple', datetime('now') FROM nen_pet_profiles GROUP BY friend_id HAVING COUNT(*) >= 2;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id, 'nen-tag-pet-dog', datetime('now') FROM nen_pet_profiles WHERE animal_type = 'dog';
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id, 'nen-tag-pet-cat', datetime('now') FROM nen_pet_profiles WHERE animal_type = 'cat';
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT friend_id, 'nen-tag-pet-dog-and-cat', datetime('now')
FROM nen_pet_profiles GROUP BY friend_id
HAVING SUM(animal_type='dog') > 0 AND SUM(animal_type='cat') > 0;

-- 体重による犬のサイズ、年齢、誕生月、プロフィール画像。
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id,
  CASE WHEN weight_kg <= 10 THEN 'nen-tag-pet-small-dog'
       WHEN weight_kg <= 25 THEN 'nen-tag-pet-medium-dog'
       ELSE 'nen-tag-pet-large-dog' END,
  datetime('now')
FROM nen_pet_profiles WHERE animal_type='dog' AND weight_kg IS NOT NULL;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id,
  CASE WHEN CAST((julianday('now') - julianday(birthday)) / 365.2425 AS INTEGER) < 1 THEN 'nen-tag-pet-young'
       WHEN CAST((julianday('now') - julianday(birthday)) / 365.2425 AS INTEGER) >= 7 THEN 'nen-tag-pet-senior'
       ELSE 'nen-tag-pet-adult' END,
  datetime('now')
FROM nen_pet_profiles WHERE birthday IS NOT NULL;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id, 'nen-tag-pet-birthday-this-month', datetime('now')
FROM nen_pet_profiles WHERE substr(birthday, 6, 2) = strftime('%m', 'now', '+9 hours');
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id, 'nen-tag-pet-birthday-next-month', datetime('now')
FROM nen_pet_profiles
WHERE CAST(substr(birthday, 6, 2) AS INTEGER) = ((CAST(strftime('%m', 'now', '+9 hours') AS INTEGER) % 12) + 1);
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id, 'nen-tag-pet-profile-photo', datetime('now')
FROM nen_pet_profiles WHERE image_url IS NOT NULL AND image_url <> '';

-- 登録されたお悩み。
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT p.friend_id,
  CASE concern.value
    WHEN 'tear_stain' THEN 'nen-tag-concern-tear-stain'
    WHEN 'coat' THEN 'nen-tag-concern-coat'
    WHEN 'allergy' THEN 'nen-tag-concern-allergy'
    WHEN 'appetite' THEN 'nen-tag-concern-appetite'
    WHEN 'stool' THEN 'nen-tag-concern-stool'
    WHEN 'weight' THEN 'nen-tag-concern-weight'
    ELSE 'nen-tag-concern-other'
  END,
  datetime('now')
FROM nen_pet_profiles p, json_each(p.concerns) concern;

-- 健康日記と要確認状態。
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id, 'nen-tag-health-diary', datetime('now') FROM nen_health_logs;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id, 'nen-tag-health-weight-log', datetime('now') FROM nen_health_logs WHERE weight_kg IS NOT NULL;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id, 'nen-tag-health-heart-log', datetime('now') FROM nen_health_logs WHERE heart_rate_bpm IS NOT NULL;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id, 'nen-tag-health-breath-log', datetime('now') FROM nen_health_logs WHERE respiratory_rate_bpm IS NOT NULL;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id,
  CASE flag_type WHEN 'poor_appetite' THEN 'nen-tag-health-appetite-check' ELSE 'nen-tag-health-stool-check' END,
  datetime('now')
FROM nen_care_flags WHERE status='active';

-- 写真投稿・審査状況。
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id, 'nen-tag-action-photo-posted', datetime('now') FROM nen_photo_submissions;
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id, 'nen-tag-action-photo-review', datetime('now') FROM nen_photo_submissions WHERE status='pending';
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT friend_id, 'nen-tag-action-photo-approved', datetime('now') FROM nen_photo_submissions WHERE status='adopted';

-- 定期便データがない会員は未契約。
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT f.id, 'nen-tag-subscription-none', datetime('now')
FROM friends f LEFT JOIN nen_ec_member_snapshots s ON s.friend_id=f.id
WHERE f.is_following=1 AND (s.subscription_json IS NULL OR json_array_length(json_extract(s.subscription_json, '$.contracts')) = 0);

-- 定期便は複数契約を持てるため、契約ごとの状態を集約する。
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT s.friend_id,
  CASE
    WHEN lower(COALESCE(json_extract(contract.value, '$.status'), '') || ' ' || COALESCE(json_extract(contract.value, '$.status_code'), ''))
         LIKE '%failed%' OR json_extract(contract.value, '$.status') LIKE '%決済%' THEN 'nen-tag-subscription-failed'
    WHEN lower(COALESCE(json_extract(contract.value, '$.status'), '') || ' ' || COALESCE(json_extract(contract.value, '$.status_code'), ''))
         LIKE '%cancel%' OR json_extract(contract.value, '$.status') LIKE '%解約%' THEN 'nen-tag-subscription-cancelled'
    WHEN lower(COALESCE(json_extract(contract.value, '$.status'), '') || ' ' || COALESCE(json_extract(contract.value, '$.status_code'), ''))
         LIKE '%pause%' OR json_extract(contract.value, '$.status') LIKE '%休止%' THEN 'nen-tag-subscription-paused'
    ELSE 'nen-tag-subscription-active'
  END,
  datetime('now')
FROM nen_ec_member_snapshots s, json_each(json_extract(s.subscription_json, '$.contracts')) contract;

INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
SELECT DISTINCT s.friend_id, 'nen-tag-subscription-next-7d', datetime('now')
FROM nen_ec_member_snapshots s, json_each(json_extract(s.subscription_json, '$.contracts')) contract
WHERE (
  julianday(json_extract(contract.value, '$.next_shipping_date')) - julianday('now', '+9 hours') BETWEEN 0 AND 7
  OR julianday(json_extract(contract.value, '$.next_charge_date')) - julianday('now', '+9 hours') BETWEEN 0 AND 7
);
