-- NEN: 既存の友だち追加5%OFF設定だけを、EC-CUBEで作成済みの共通クーポンへ切り替える。
-- LINEアカウントIDや環境固有値は固定せず、今回の旧設定と一致する有効な行だけを更新する。
UPDATE account_settings
SET value = json_set(
      value,
      '$.deliveryMode', 'shared',
      '$.sharedCouponCode', 'LINEREG5',
      '$.sharedValidTo', '2026-12-31',
      '$.discountRate', 5,
      '$.messageTemplate', '友だち追加ありがとうございます🌿

然-NEN-公式オンラインストアで使える、会員限定{discount_rate}%OFFクーポンをプレゼントします。

クーポンコード：{coupon_code}
有効期限：{expires_on}まで
※会員ログイン後にご利用ください。
※お一人様1回限りです。

然-NEN-公式オンラインストアでは、お買い物金額に応じてポイントが貯まります。
今後は、お買い物以外でもポイントが貯まる企画や、貯めたポイントで受け取れる特典をLINEで順次ご案内します🌿

▼オンラインストア
https://nen-petfood.com/'
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
WHERE key = 'nen.friend_add_coupon'
  AND json_valid(value)
  AND json_extract(value, '$.isEnabled') = 1
  AND COALESCE(json_extract(value, '$.deliveryMode'), 'generated') = 'generated'
  AND UPPER(TRIM(COALESCE(json_extract(value, '$.codePrefix'), ''))) = 'NENLINE'
  AND json_extract(value, '$.discountRate') = 5
  AND TRIM(COALESCE(json_extract(value, '$.couponName'), '')) = 'LINE友だち追加 5%OFF';
