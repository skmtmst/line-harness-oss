-- 然-NEN- タグカタログ
--
-- タグ管理画面でカテゴリごとにまとまって見えるよう、名称の先頭に分類名を付ける。
-- 既存タグ・既存の友だちへの付与状態は変更せず、同名タグは再作成しない。

INSERT OR IGNORE INTO tags (id, name, color, created_at) VALUES
  -- 会員（9）
  ('nen-tag-member-nen',              '[会員] NEN会員',                    '#10B981', datetime('now')),
  ('nen-tag-member-line-linked',      '[会員] LINEログイン連携済み',       '#10B981', datetime('now')),
  ('nen-tag-member-ec-linked',        '[会員] EC顧客連携済み',             '#10B981', datetime('now')),
  ('nen-tag-member-email',            '[会員] メールアドレス登録あり',     '#10B981', datetime('now')),
  ('nen-tag-member-profile-pending',  '[会員] 会員情報未完了',             '#10B981', datetime('now')),
  ('nen-tag-member-rank-basic',       '[会員] ランク：会員',               '#10B981', datetime('now')),
  ('nen-tag-member-rank-silver',      '[会員] ランク：シルバー',           '#10B981', datetime('now')),
  ('nen-tag-member-rank-gold',        '[会員] ランク：ゴールド',           '#10B981', datetime('now')),
  ('nen-tag-member-rank-platinum',    '[会員] ランク：プラチナ',           '#10B981', datetime('now')),

  -- 購入（14）
  ('nen-tag-purchase-none',           '[購入] 未購入',                     '#3B82F6', datetime('now')),
  ('nen-tag-purchase-first',          '[購入] 初回購入',                   '#3B82F6', datetime('now')),
  ('nen-tag-purchase-experienced',    '[購入] 購入経験あり',               '#3B82F6', datetime('now')),
  ('nen-tag-purchase-repeat',         '[購入] リピーター',                 '#3B82F6', datetime('now')),
  ('nen-tag-purchase-cart-abandoned', '[購入] カゴ落ち',                   '#3B82F6', datetime('now')),
  ('nen-tag-purchase-recent-30',      '[購入] 最終購入30日以内',           '#3B82F6', datetime('now')),
  ('nen-tag-purchase-recent-90',      '[購入] 最終購入31〜90日',           '#3B82F6', datetime('now')),
  ('nen-tag-purchase-dormant',        '[購入] 最終購入91日以上',           '#3B82F6', datetime('now')),
  ('nen-tag-purchase-total-20k',      '[購入] 累計購入2万円以上',          '#3B82F6', datetime('now')),
  ('nen-tag-purchase-total-50k',      '[購入] 累計購入5万円以上',          '#3B82F6', datetime('now')),
  ('nen-tag-purchase-total-100k',     '[購入] 累計購入10万円以上',         '#3B82F6', datetime('now')),
  ('nen-tag-payment-amazon-pay',      '[購入] Amazon Pay利用',             '#3B82F6', datetime('now')),
  ('nen-tag-payment-card',            '[購入] クレジットカード利用',       '#3B82F6', datetime('now')),
  ('nen-tag-payment-bank',            '[購入] 銀行振込利用',               '#3B82F6', datetime('now')),

  -- 定期便（9）
  ('nen-tag-subscription-none',       '[定期便] 未契約',                   '#8B5CF6', datetime('now')),
  ('nen-tag-subscription-interested', '[定期便] 関心あり',                 '#8B5CF6', datetime('now')),
  ('nen-tag-subscription-active',     '[定期便] 契約中',                   '#8B5CF6', datetime('now')),
  ('nen-tag-subscription-paused',     '[定期便] 休止中',                   '#8B5CF6', datetime('now')),
  ('nen-tag-subscription-cancelled',  '[定期便] 解約済み',                 '#8B5CF6', datetime('now')),
  ('nen-tag-subscription-failed',     '[定期便] 決済失敗',                 '#8B5CF6', datetime('now')),
  ('nen-tag-subscription-next-7d',    '[定期便] 次回発送7日以内',          '#8B5CF6', datetime('now')),
  ('nen-tag-subscription-6m',         '[定期便] 継続6か月以上',            '#8B5CF6', datetime('now')),
  ('nen-tag-subscription-12m',        '[定期便] 継続12か月以上',           '#8B5CF6', datetime('now')),

  -- ペット（15）
  ('nen-tag-pet-unregistered',        '[ペット] 未登録',                   '#EC4899', datetime('now')),
  ('nen-tag-pet-registered',          '[ペット] 登録済み',                 '#EC4899', datetime('now')),
  ('nen-tag-pet-multiple',            '[ペット] 多頭飼い',                 '#EC4899', datetime('now')),
  ('nen-tag-pet-dog',                 '[ペット] わんちゃん',               '#EC4899', datetime('now')),
  ('nen-tag-pet-cat',                 '[ペット] ねこちゃん',               '#EC4899', datetime('now')),
  ('nen-tag-pet-dog-and-cat',         '[ペット] 犬猫どちらも',             '#EC4899', datetime('now')),
  ('nen-tag-pet-small-dog',           '[ペット] 小型犬',                   '#EC4899', datetime('now')),
  ('nen-tag-pet-medium-dog',          '[ペット] 中型犬',                   '#EC4899', datetime('now')),
  ('nen-tag-pet-large-dog',           '[ペット] 大型犬',                   '#EC4899', datetime('now')),
  ('nen-tag-pet-young',               '[ペット] 子犬・子猫',               '#EC4899', datetime('now')),
  ('nen-tag-pet-adult',               '[ペット] 成犬・成猫',               '#EC4899', datetime('now')),
  ('nen-tag-pet-senior',              '[ペット] シニア犬・シニア猫',       '#EC4899', datetime('now')),
  ('nen-tag-pet-birthday-this-month', '[ペット] 誕生日が今月',             '#EC4899', datetime('now')),
  ('nen-tag-pet-birthday-next-month', '[ペット] 誕生日が翌月',             '#EC4899', datetime('now')),
  ('nen-tag-pet-profile-photo',       '[ペット] アイコン画像登録済み',     '#EC4899', datetime('now')),

  -- お悩み（11）
  ('nen-tag-concern-tear-stain',      '[お悩み] 涙やけ',                   '#F59E0B', datetime('now')),
  ('nen-tag-concern-coat',            '[お悩み] 毛並み',                   '#F59E0B', datetime('now')),
  ('nen-tag-concern-allergy',         '[お悩み] アレルギー',               '#F59E0B', datetime('now')),
  ('nen-tag-concern-appetite',        '[お悩み] 食いつき',                 '#F59E0B', datetime('now')),
  ('nen-tag-concern-stool',           '[お悩み] 便',                       '#F59E0B', datetime('now')),
  ('nen-tag-concern-weight',          '[お悩み] 体重',                     '#F59E0B', datetime('now')),
  ('nen-tag-concern-skin',            '[お悩み] 皮膚',                     '#F59E0B', datetime('now')),
  ('nen-tag-concern-digestion',       '[お悩み] 消化',                     '#F59E0B', datetime('now')),
  ('nen-tag-concern-oral',            '[お悩み] 口腔・歯',                 '#F59E0B', datetime('now')),
  ('nen-tag-concern-joint',           '[お悩み] 関節',                     '#F59E0B', datetime('now')),
  ('nen-tag-concern-other',           '[お悩み] その他',                   '#F59E0B', datetime('now')),

  -- 健康（7）
  ('nen-tag-health-diary',            '[健康] 健康日記利用あり',           '#06B6D4', datetime('now')),
  ('nen-tag-health-weight-log',       '[健康] 体重記録あり',               '#06B6D4', datetime('now')),
  ('nen-tag-health-heart-log',        '[健康] 心拍数記録あり',             '#06B6D4', datetime('now')),
  ('nen-tag-health-breath-log',       '[健康] 呼吸数記録あり',             '#06B6D4', datetime('now')),
  ('nen-tag-health-appetite-check',   '[健康] 要確認：食いつき不良',       '#06B6D4', datetime('now')),
  ('nen-tag-health-stool-check',      '[健康] 要確認：便の異常',           '#06B6D4', datetime('now')),
  ('nen-tag-health-weight-check',     '[健康] 要確認：体重変化',           '#06B6D4', datetime('now')),

  -- 興味・関心（11）
  ('nen-tag-interest-venison',        '[興味] 鹿肉・ジビエ',               '#14B8A6', datetime('now')),
  ('nen-tag-interest-pet-food',       '[興味] ペットフード',               '#14B8A6', datetime('now')),
  ('nen-tag-interest-health',         '[興味] 健康管理',                   '#14B8A6', datetime('now')),
  ('nen-tag-interest-nutrition',      '[興味] 食育',                       '#14B8A6', datetime('now')),
  ('nen-tag-interest-tear-stain',     '[興味] 涙やけケア',                 '#14B8A6', datetime('now')),
  ('nen-tag-interest-allergy',        '[興味] アレルギーケア',             '#14B8A6', datetime('now')),
  ('nen-tag-interest-skin-coat',      '[興味] 毛並み・皮膚ケア',           '#14B8A6', datetime('now')),
  ('nen-tag-interest-weight',         '[興味] 体重管理',                   '#14B8A6', datetime('now')),
  ('nen-tag-interest-senior',         '[興味] シニアケア',                 '#14B8A6', datetime('now')),
  ('nen-tag-interest-coupon',         '[興味] クーポン',                   '#14B8A6', datetime('now')),
  ('nen-tag-interest-column',         '[興味] NENコラム',                  '#14B8A6', datetime('now')),

  -- 行動（8）
  ('nen-tag-action-column-view',      '[行動] コラム閲覧あり',             '#6366F1', datetime('now')),
  ('nen-tag-action-product-view',     '[行動] 商品ページ閲覧あり',         '#6366F1', datetime('now')),
  ('nen-tag-action-coupon-use',       '[行動] クーポン利用あり',           '#6366F1', datetime('now')),
  ('nen-tag-action-photo-posted',     '[行動] 写真投稿あり',               '#6366F1', datetime('now')),
  ('nen-tag-action-photo-review',     '[行動] 写真審査中',                 '#6366F1', datetime('now')),
  ('nen-tag-action-photo-approved',   '[行動] 写真採用あり',               '#6366F1', datetime('now')),
  ('nen-tag-action-message-response', '[行動] LINEメッセージ反応あり',     '#6366F1', datetime('now')),
  ('nen-tag-action-diary-continued',  '[行動] 健康日記継続中',             '#6366F1', datetime('now')),

  -- 配信対象（8）
  ('nen-tag-delivery-order',          '[配信] 注文完了通知対象',           '#6B7280', datetime('now')),
  ('nen-tag-delivery-shipped',        '[配信] 発送完了通知対象',           '#6B7280', datetime('now')),
  ('nen-tag-delivery-arrival',        '[配信] 商品到着確認対象',           '#6B7280', datetime('now')),
  ('nen-tag-delivery-review',         '[配信] 口コミ依頼対象',             '#6B7280', datetime('now')),
  ('nen-tag-delivery-recommendation', '[配信] 商品・定期便提案対象',       '#6B7280', datetime('now')),
  ('nen-tag-delivery-column',         '[配信] コラム配信対象',             '#6B7280', datetime('now')),
  ('nen-tag-delivery-birthday',       '[配信] 誕生日クーポン対象',         '#6B7280', datetime('now')),
  ('nen-tag-delivery-optout',         '[配信] 配信停止希望',               '#6B7280', datetime('now')),

  -- 商品（8）
  ('nen-tag-product-mince',           '[商品] 鹿肉ミンチ購入',             '#84CC16', datetime('now')),
  ('nen-tag-product-rib',             '[商品] 鹿肉アバラ骨購入',           '#84CC16', datetime('now')),
  ('nen-tag-product-balance',         '[商品] 毎日の鹿肉バランス購入',     '#84CC16', datetime('now')),
  ('nen-tag-product-treat',           '[商品] 鹿肉おやつ購入',             '#84CC16', datetime('now')),
  ('nen-tag-product-set',             '[商品] セット商品購入',             '#84CC16', datetime('now')),
  ('nen-tag-product-single',          '[商品] 単品商品購入',               '#84CC16', datetime('now')),
  ('nen-tag-product-trial',           '[商品] 初回お試し商品購入',         '#84CC16', datetime('now')),
  ('nen-tag-product-subscription',    '[商品] 定期便商品購入',             '#84CC16', datetime('now'));
