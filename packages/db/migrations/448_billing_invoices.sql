-- Stripe の請求書を運営ダッシュボードの入金実績として保存する。
-- 顧客名・メール・カード情報は保存せず、請求と金額・期間だけを持つ。

CREATE TABLE IF NOT EXISTS billing_invoices (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  stripe_customer_id  TEXT,
  subscription_id     TEXT,
  status              TEXT,
  amount_paid         INTEGER NOT NULL DEFAULT 0,
  amount_due          INTEGER NOT NULL DEFAULT 0,
  amount_refunded     INTEGER NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'jpy',
  interval            TEXT CHECK (interval IN ('month', 'year')),
  period_start        TEXT,
  period_end          TEXT,
  paid_at             TEXT,
  hosted_invoice_url  TEXT,
  raw_updated_at      TEXT,
  synced_at           TEXT NOT NULL,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_tenant_paid
  ON billing_invoices(tenant_id, paid_at);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_paid
  ON billing_invoices(paid_at);
