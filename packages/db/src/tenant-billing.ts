import { jstNow } from './utils.js';

/**
 * 統括の課金（★V6 36-2）。tenants の課金列と、Stripe Webhook の重複防止。
 */

export const TENANT_PLAN_STATUSES = ['exempt', 'trialing', 'active', 'past_due', 'canceled'] as const;
export type TenantPlanStatus = (typeof TENANT_PLAN_STATUSES)[number];

export interface TenantBilling {
  id: string;
  name: string;
  plan_key: string | null;
  plan_status: TenantPlanStatus;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_ends_at: string | null;
  plan_updated_at: string | null;
}

const COLUMNS =
  'id, name, plan_key, plan_status, trial_ends_at, stripe_customer_id, stripe_subscription_id, current_period_ends_at, plan_updated_at';

export async function getTenantBilling(db: D1Database, tenantId: string): Promise<TenantBilling | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM tenants WHERE id = ?`).bind(tenantId).first<TenantBilling>();
}

export async function getTenantBillingByStripeCustomer(
  db: D1Database,
  stripeCustomerId: string,
): Promise<TenantBilling | null> {
  return db
    .prepare(`SELECT ${COLUMNS} FROM tenants WHERE stripe_customer_id = ?`)
    .bind(stripeCustomerId)
    .first<TenantBilling>();
}

export async function updateTenantBilling(
  db: D1Database,
  tenantId: string,
  patch: Partial<Pick<TenantBilling, 'plan_key' | 'plan_status' | 'trial_ends_at' | 'stripe_customer_id' | 'stripe_subscription_id' | 'current_period_ends_at'>>,
): Promise<TenantBilling | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of ['plan_key', 'plan_status', 'trial_ends_at', 'stripe_customer_id', 'stripe_subscription_id', 'current_period_ends_at'] as const) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(patch[key]);
    }
  }
  if (sets.length === 0) return getTenantBilling(db, tenantId);
  const now = jstNow();
  sets.push('plan_updated_at = ?', 'updated_at = ?');
  values.push(now, now, tenantId);
  await db.prepare(`UPDATE tenants SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return getTenantBilling(db, tenantId);
}

/**
 * Stripe のイベントを記録する。すでにあれば false（＝二度目なので処理しない）。
 */
export async function recordBillingEvent(
  db: D1Database,
  input: { id: string; type: string; tenantId: string | null; summary?: string },
): Promise<boolean> {
  const result = await db
    .prepare('INSERT OR IGNORE INTO billing_events (id, type, tenant_id, summary) VALUES (?, ?, ?, ?)')
    .bind(input.id, input.type, input.tenantId, input.summary ?? '')
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
