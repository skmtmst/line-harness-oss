-- 検証環境専用の実機確認リセット。
-- 本番へ統合しない運用ブランチでのみ実行する。
-- 一致が1件でなければ、どちらのUPDATE/DELETEも0件になる。

WITH candidates AS (
  SELECT f.id AS friend_id
    FROM nen_friend_add_coupon_issues i
    JOIN friends f ON f.id = i.friend_id
    JOIN line_accounts la ON la.id = i.line_account_id
    JOIN account_settings s
      ON s.line_account_id = i.line_account_id
     AND s.key = 'nen.friend_add_coupon'
   WHERE la.name = '然-NEN- TEST'
     AND f.display_name = 'さかもとまさと'
     AND f.is_following = 0
     AND f.unfollow_count > 0
     AND i.status = 'sent'
     AND i.coupon_code LIKE 'NENLINE-%'
     AND json_valid(s.value)
     AND json_extract(s.value, '$.deliveryMode') = 'shared'
     AND json_extract(s.value, '$.sharedCouponCode') = 'LINEREG5'
)
UPDATE friends
   SET unfollow_count = 0,
       updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
 WHERE id IN (SELECT friend_id FROM candidates)
   AND (SELECT COUNT(*) FROM candidates) = 1;

WITH candidates AS (
  SELECT i.id AS issue_id
    FROM nen_friend_add_coupon_issues i
    JOIN friends f ON f.id = i.friend_id
    JOIN line_accounts la ON la.id = i.line_account_id
    JOIN account_settings s
      ON s.line_account_id = i.line_account_id
     AND s.key = 'nen.friend_add_coupon'
   WHERE la.name = '然-NEN- TEST'
     AND f.display_name = 'さかもとまさと'
     AND f.is_following = 0
     AND f.unfollow_count = 0
     AND i.status = 'sent'
     AND i.coupon_code LIKE 'NENLINE-%'
     AND json_valid(s.value)
     AND json_extract(s.value, '$.deliveryMode') = 'shared'
     AND json_extract(s.value, '$.sharedCouponCode') = 'LINEREG5'
)
DELETE FROM nen_friend_add_coupon_issues
 WHERE id IN (SELECT issue_id FROM candidates)
   AND (SELECT COUNT(*) FROM candidates) = 1;
