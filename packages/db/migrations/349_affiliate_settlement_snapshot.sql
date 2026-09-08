-- 承認済み報酬の確定時に、金額の計算根拠を版として固定する。
-- 確定後に紹介者の率や案件の固定額を編集しても、確定済みの金額と根拠は変わらない。
-- 要件 v6-16 §9: 現在値を参照して再計算しない。式・入力・丸め・currencyを保存する。
CREATE TABLE IF NOT EXISTS affiliate_reward_calculations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  conversion_event_id TEXT NOT NULL REFERENCES conversion_events(id),
  offer_id TEXT REFERENCES affiliate_offers(id),
  formula TEXT NOT NULL CHECK (formula IN ('rate', 'fixed', 'legacy')),
  commission_rate_snapshot REAL,
  base_amount_snapshot REAL,
  fixed_reward_snapshot INTEGER,
  offer_name_snapshot TEXT NOT NULL DEFAULT '',
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY' CHECK (currency = 'JPY'),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (conversion_event_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_reward_calculations_scope
  ON affiliate_reward_calculations(organization_id, line_account_id, affiliate_id);

-- 移行前に締めた分は計算根拠が残っていないため、金額だけを引き継ぐ。
-- formula='legacy' は「確定時の根拠は記録なし」を表し、後から現在値で埋めない。
INSERT OR IGNORE INTO affiliate_reward_calculations
  (id, organization_id, line_account_id, affiliate_id, conversion_event_id,
   offer_id, formula, offer_name_snapshot, amount_minor, currency, created_at)
SELECT 'calc-legacy:' || re.id, re.organization_id, re.line_account_id, re.affiliate_id,
  re.conversion_event_id, re.offer_id, 'legacy', '', re.amount_minor, re.currency, re.created_at
FROM affiliate_reward_entries re
WHERE re.entry_type = 'credit';

-- 既存entryを対応するlegacy版へ決定的に紐付ける。entryと版は成果ごとに
-- 1対1のはずだが、対応が1件に定まらない曖昧な行はNULLのまま残し、
-- 後から監査できる状態にする(偽の紐付けを作らない)。既に版がある行は触らない。
UPDATE affiliate_reward_entries
SET reward_calculation_id = (
  SELECT c.id FROM affiliate_reward_calculations c
  WHERE c.conversion_event_id = affiliate_reward_entries.conversion_event_id
    AND c.formula = 'legacy'
)
WHERE entry_type = 'credit'
  AND reward_calculation_id IS NULL
  AND (SELECT COUNT(*) FROM affiliate_reward_calculations c
       WHERE c.conversion_event_id = affiliate_reward_entries.conversion_event_id
         AND c.formula = 'legacy') = 1;
