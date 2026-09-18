-- 然-NEN- 主食のカロリー表を「主食」と「然の商品（おやつ）」に分け、おやつの上限（%）を持つ（★V6 37-3-A 更新・2026-09-18 採用）。
-- 追加のみ。既存の行は kind='staple'（主食）として扱う。
ALTER TABLE nen_feeding_products ADD COLUMN kind TEXT NOT NULL DEFAULT 'staple' CHECK (kind IN ('staple', 'nen'));

CREATE TABLE IF NOT EXISTS nen_feeding_settings (
  line_account_id     TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  treat_limit_percent INTEGER NOT NULL DEFAULT 10 CHECK (treat_limit_percent BETWEEN 1 AND 30),
  updated_at          TEXT NOT NULL
);
