-- 広告設定と送信記録をLINEアカウントごとに分ける(#638)。
-- sendAdConversions が全店の有効設定へ送信し、他店へ行動・金額を送り得たため、
-- 設定と送信記録に帰属を持たせる。既存行は帰属不明のため NULL のまま残す(消さない)。
-- NULL の設定へは送信しない(帰属不明の外部送信を出さないため)。
ALTER TABLE ad_platforms ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_ad_platforms_account ON ad_platforms(line_account_id);
ALTER TABLE ad_conversion_logs ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ad_conversion_logs_account ON ad_conversion_logs(line_account_id);
