-- マイルの使い道の版に、交換できる友だちの条件を固定して残す。
-- 公開後も当時の条件を再現できるよう、使い道本体ではなく版へ保存する。

ALTER TABLE mileage_reward_versions
  ADD COLUMN target_conditions TEXT;
