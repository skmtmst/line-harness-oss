import { findPlan } from './billing-plans.js';
import { hqBillingMetrics } from '../features/hq-billing/hq-billing-metrics/index.js';

/** Stored counters only. A plan's list price is explicitly separate from the invoiced amount. */
export async function opsTenantMetrics(db:D1Database,tenantId:string) {
  const [billing,tenant,counts,support]=await Promise.all([
    hqBillingMetrics(db,tenantId),
    db.prepare('SELECT plan_key FROM tenants WHERE id=?').bind(tenantId).first<{plan_key:string|null}>(),
    db.prepare(`SELECT COUNT(*) account_count,SUM(CASE WHEN a.is_active=1 THEN 1 ELSE 0 END) active_account_count,
      COALESCE(SUM((SELECT COUNT(*) FROM friends f WHERE f.line_account_id=a.id)),0) friend_count
      FROM line_accounts a WHERE a.tenant_id=? AND a.archived_at IS NULL`).bind(tenantId).first<{account_count:number;active_account_count:number|null;friend_count:number}>(),
    db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) unresolved FROM hq_support_requests WHERE tenant_id=?`).bind(tenantId).first<{total:number;unresolved:number|null}>(),
  ]);
  return {monthlyListPriceYen:findPlan(tenant?.plan_key??null)?.fallbackMonthlyYen??null,monthlyListPriceSource:'plan_catalog',
    thisMonthBilledYen:billing?.thisMonthBilledYen??null,invoiceSource:'stored_invoices',
    accountCount:counts?.account_count??0,activeAccountCount:counts?.active_account_count??0,friendCount:counts?.friend_count??0,
    friendChangeLastMonth:null,supportCount:support?.total??0,unresolvedSupportCount:support?.unresolved??0};
}
