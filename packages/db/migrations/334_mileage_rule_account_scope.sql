-- 旧マイルールにアカウントの帰属を持たせる(#521)。
-- 既に V6 下書きへ割り当て済みの行は、その下書きのアカウントへ帰属させる。
-- 未割当の既存行(NULL)は互換用の全店ルールとして残すが、API からは変更できない。
ALTER TABLE mileage_rules ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id);
UPDATE mileage_rules
   SET line_account_id = (
     SELECT d.line_account_id FROM mileage_earning_rule_drafts d WHERE d.rule_id = mileage_rules.id
   )
 WHERE EXISTS (
   SELECT 1 FROM mileage_earning_rule_drafts d WHERE d.rule_id = mileage_rules.id
 );
CREATE INDEX IF NOT EXISTS idx_mileage_rules_account ON mileage_rules(line_account_id);
