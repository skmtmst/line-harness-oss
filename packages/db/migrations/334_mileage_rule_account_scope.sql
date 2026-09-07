-- 旧マイルール(全店共通)にアカウントの帰属を持たせる(#521)。
-- NULL=全店共通(従来どおり全店に効く)。既存行はすべて NULL のまま残す。
ALTER TABLE mileage_rules ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mileage_rules_account ON mileage_rules(line_account_id);
