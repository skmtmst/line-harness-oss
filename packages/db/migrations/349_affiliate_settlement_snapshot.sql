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

-- 所有tenantが空の紹介者は、所属アカウントのtenantへ決定移行する。
-- 決まらない行(アカウント無し・accountのtenant無し)はNULLのまま残し、
-- 締め側はfail-closedで遮断する。
UPDATE affiliates
SET tenant_id = (
  SELECT la.tenant_id FROM line_accounts la WHERE la.id = affiliates.line_account_id
)
WHERE tenant_id IS NULL
  AND line_account_id IS NOT NULL
  AND (SELECT la.tenant_id FROM line_accounts la WHERE la.id = affiliates.line_account_id) IS NOT NULL;

-- 承認済み・未締めの成果をすべて決定論的に版化する。これ以降の締めは
-- 版だけを使うため、ここで凍結しないと移行後の設定編集で金額が動く。
-- 金額0も版にする。id帰属をcode帰属より先に固め、重なりはidを優先する。
-- 版あり・確定済み・所属不明は触らない。
INSERT OR IGNORE INTO affiliate_reward_calculations
  (id, organization_id, line_account_id, affiliate_id, conversion_event_id,
   offer_id, formula, commission_rate_snapshot, base_amount_snapshot,
   fixed_reward_snapshot, offer_name_snapshot, amount_minor, currency, created_at)
SELECT 'calc-349:' || ce.id,
  COALESCE(a.tenant_id, la.tenant_id),
  a.line_account_id, a.id, ce.id,
  off.id,
  CASE WHEN COALESCE(a.commission_rate, 0) > 0 THEN 'rate' ELSE 'fixed' END,
  CASE WHEN COALESCE(a.commission_rate, 0) > 0 THEN a.commission_rate ELSE NULL END,
  CASE WHEN COALESCE(a.commission_rate, 0) > 0
    THEN COALESCE(ce.value_snapshot, cp.value, 0) ELSE NULL END,
  CASE WHEN COALESCE(a.commission_rate, 0) > 0
    THEN NULL ELSE COALESCE(off.reward_amount, 0) END,
  COALESCE(off.name, ce.point_name_snapshot, cp.name, ''),
  COALESCE(ROUND(CASE WHEN COALESCE(a.commission_rate, 0) > 0
    THEN COALESCE(ce.value_snapshot, cp.value, 0) * a.commission_rate / 100.0
    ELSE COALESCE(off.reward_amount, 0) END), 0),
  'JPY', ce.approved_at
FROM conversion_events ce
JOIN affiliates a ON a.id = ce.affiliate_id
JOIN friends f ON f.id = ce.friend_id AND f.line_account_id = a.line_account_id
LEFT JOIN line_accounts la ON la.id = a.line_account_id
LEFT JOIN conversion_points cp ON cp.id = ce.conversion_point_id AND cp.line_account_id = a.line_account_id
LEFT JOIN affiliate_links al
  ON al.ref_code = ce.attributed_ref_code
 AND al.affiliate_id = a.id AND al.line_account_id = a.line_account_id
LEFT JOIN affiliate_offers off ON off.id = al.offer_id AND off.line_account_id = a.line_account_id
WHERE COALESCE(ce.approval_status, 'pending') = 'approved'
  AND ce.approved_at IS NOT NULL
  AND ce.affiliate_id IS NOT NULL
  AND a.line_account_id IS NOT NULL
  AND COALESCE(a.tenant_id, la.tenant_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM affiliate_reward_entries re
    WHERE re.conversion_event_id = ce.id AND re.entry_type = 'credit'
  )
  AND NOT EXISTS (
    SELECT 1 FROM affiliate_reward_calculations c WHERE c.conversion_event_id = ce.id
  );

INSERT OR IGNORE INTO affiliate_reward_calculations
  (id, organization_id, line_account_id, affiliate_id, conversion_event_id,
   offer_id, formula, commission_rate_snapshot, base_amount_snapshot,
   fixed_reward_snapshot, offer_name_snapshot, amount_minor, currency, created_at)
SELECT 'calc-349:' || ce.id,
  COALESCE(a.tenant_id, la.tenant_id),
  a.line_account_id, a.id, ce.id,
  off.id,
  CASE WHEN COALESCE(a.commission_rate, 0) > 0 THEN 'rate' ELSE 'fixed' END,
  CASE WHEN COALESCE(a.commission_rate, 0) > 0 THEN a.commission_rate ELSE NULL END,
  CASE WHEN COALESCE(a.commission_rate, 0) > 0
    THEN COALESCE(ce.value_snapshot, cp.value, 0) ELSE NULL END,
  CASE WHEN COALESCE(a.commission_rate, 0) > 0
    THEN NULL ELSE COALESCE(off.reward_amount, 0) END,
  COALESCE(off.name, ce.point_name_snapshot, cp.name, ''),
  COALESCE(ROUND(CASE WHEN COALESCE(a.commission_rate, 0) > 0
    THEN COALESCE(ce.value_snapshot, cp.value, 0) * a.commission_rate / 100.0
    ELSE COALESCE(off.reward_amount, 0) END), 0),
  'JPY', ce.approved_at
FROM conversion_events ce
JOIN affiliates a ON ce.affiliate_id IS NULL AND ce.affiliate_code = a.code
JOIN friends f ON f.id = ce.friend_id AND f.line_account_id = a.line_account_id
LEFT JOIN line_accounts la ON la.id = a.line_account_id
LEFT JOIN conversion_points cp ON cp.id = ce.conversion_point_id AND cp.line_account_id = a.line_account_id
LEFT JOIN affiliate_links al
  ON al.ref_code = ce.attributed_ref_code
 AND al.affiliate_id = a.id AND al.line_account_id = a.line_account_id
LEFT JOIN affiliate_offers off ON off.id = al.offer_id AND off.line_account_id = a.line_account_id
WHERE COALESCE(ce.approval_status, 'pending') = 'approved'
  AND ce.approved_at IS NOT NULL
  AND a.line_account_id IS NOT NULL
  AND COALESCE(a.tenant_id, la.tenant_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM affiliate_reward_entries re
    WHERE re.conversion_event_id = ce.id AND re.entry_type = 'credit'
  )
  AND NOT EXISTS (
    SELECT 1 FROM affiliate_reward_calculations c WHERE c.conversion_event_id = ce.id
  );
