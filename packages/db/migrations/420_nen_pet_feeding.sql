-- 然-NEN- マイペットの給与量（★V6 37-2 マイページ「今日の目安」）。
--
-- 1日の目安は NRC／FEDIAF の式で出す：
--   安静時エネルギー RER = 70 × 体重(kg)^0.75
--   1日の必要カロリー MER = RER × 係数（年齢区分・避妊去勢・活動量で決まる）
--   目安のグラム数 = MER ÷ 主食の 100g あたり kcal × 100
-- 主食のカロリーは LINE 管理画面（専用機能 → 会員 → 給与量）で商品ごとに持つ。
-- ペットの正本は LINE 側（EC へは送り返さない）。追加のみ。既存列は変更しない。

-- 避妊去勢：1 = 済み、0 = していない、NULL = 未回答（計算では「済み」として控えめに見積もる）。
ALTER TABLE nen_pet_profiles ADD COLUMN neutered INTEGER CHECK (neutered IN (0, 1));
-- 活動量：low（少なめ）／normal（ふつう）／high（多め）。
ALTER TABLE nen_pet_profiles ADD COLUMN activity_level TEXT NOT NULL DEFAULT 'normal' CHECK (activity_level IN ('low', 'normal', 'high'));
-- 計算結果（1日の必要カロリー）。表示のたびに計算し直すが、管理画面の一覧や配信の差し込み用に保存もする。
ALTER TABLE nen_pet_profiles ADD COLUMN daily_kcal INTEGER;
-- いつも与えている主食（nen_feeding_products.id）。NULL なら既定の主食。
ALTER TABLE nen_pet_profiles ADD COLUMN feeding_product_id TEXT;

-- 主食のカロリー表（アカウントごと）。
CREATE TABLE IF NOT EXISTS nen_feeding_products (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  kcal_per_100g   REAL NOT NULL CHECK (kcal_per_100g > 0 AND kcal_per_100g <= 1000),
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nen_feeding_products_account
  ON nen_feeding_products(line_account_id, sort_order);
