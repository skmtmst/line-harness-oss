-- 統括の課金（★V6 36-2）。
--
-- 統括ごとにプランと契約状態を持つ。決済は Stripe（サブスクリプション）。
-- 状態の意味:
--   exempt    課金の対象外（運営自身・移行前からある統括）。何も止めない
--   trialing  無料トライアル中。trial_ends_at を過ぎたら「期限切れ」として扱う
--   active    契約中
--   past_due  支払いが遅れている（Stripe が再試行中）。止めずに案内だけ出す
--   canceled  解約済み。配信と生成を止め、閲覧はできる
--
-- 既存の統括はすべて exempt にして、この移行で挙動を変えない。
-- 新しく登録された統括（36-4）だけが trialing で始まる。

ALTER TABLE tenants ADD COLUMN plan_key TEXT;
ALTER TABLE tenants ADD COLUMN plan_status TEXT NOT NULL DEFAULT 'exempt'
  CHECK (plan_status IN ('exempt', 'trialing', 'active', 'past_due', 'canceled'));
ALTER TABLE tenants ADD COLUMN trial_ends_at TEXT;
ALTER TABLE tenants ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE tenants ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE tenants ADD COLUMN current_period_ends_at TEXT;
ALTER TABLE tenants ADD COLUMN plan_updated_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_stripe_customer
  ON tenants(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Stripe の課金 Webhook を二度処理しないための記録。id は Stripe のイベントID。
CREATE TABLE IF NOT EXISTS billing_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  tenant_id    TEXT,
  summary      TEXT NOT NULL DEFAULT '',
  received_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_billing_events_tenant
  ON billing_events(tenant_id, received_at DESC);
