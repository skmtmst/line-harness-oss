import { getTenantBilling } from '@line-crm/db';
import { reportPeriod } from '@line-crm/shared';

/** A tenant has one subscription. Account counts are not individual contracts. */
export async function hqBillingMetrics(db:D1Database,tenantId:string) {
  const billing=await getTenantBilling(db,tenantId);
  if(!billing)return null;
  const period=reportPeriod({period:'this_month'});
  const date="datetime(created_at, CASE WHEN substr(created_at,-1)='Z' OR substr(created_at,-6,1) IN ('+','-') THEN '+9 hours' ELSE '+0 hours' END)";
  const [invoices,accounts]=await Promise.all([
    db.prepare(`SELECT COUNT(*) observed,MAX(synced_at) last_synced_at,
      SUM(CASE WHEN ${date}>=datetime(?) AND ${date}<datetime(?) AND status IN ('open','paid','uncollectible') THEN 1 ELSE 0 END) month_observed,
      SUM(CASE WHEN ${date}>=datetime(?) AND ${date}<datetime(?) AND status IN ('open','paid','uncollectible') THEN amount_due ELSE 0 END) billed,
      SUM(CASE WHEN ${date}>=datetime(?) AND ${date}<datetime(?) AND status IN ('open','paid','uncollectible') AND lower(currency)<>'jpy' THEN 1 ELSE 0 END) foreign_billed,
      SUM(CASE WHEN status IN ('open','uncollectible') AND amount_due>amount_paid THEN 1 ELSE 0 END) unpaid
      FROM billing_invoices WHERE tenant_id=?`).bind(period.from,period.until,period.from,period.until,period.from,period.until,tenantId).first<{observed:number;month_observed:number|null;last_synced_at:string|null;billed:number|null;foreign_billed:number|null;unpaid:number|null}>(),
    db.prepare('SELECT COUNT(*) n FROM line_accounts WHERE tenant_id=? AND is_active=1 AND archived_at IS NULL').bind(tenantId).first<{n:number}>(),
  ]);
  const observed=Number(invoices?.observed??0);
  return {period,source:'stored_invoices' as const,observedInvoiceCount:observed,lastSyncedAt:invoices?.last_synced_at??null,
    thisMonthBilledYen:Number(invoices?.month_observed??0)>0&&Number(invoices?.foreign_billed??0)===0?Number(invoices?.billed??0):null,
    contractCount:['active','past_due'].includes(billing.plan_status)?1:0,contractUnit:'organization' as const,
    activeAccountCount:Number(accounts?.n??0),contractAccountCount:null,
    trialCount:billing.plan_status==='trialing'?1:0,
    unpaidInvoiceCount:observed?Number(invoices?.unpaid??0):null,paymentFailureCount:null,
    nextBillingAt:['active','past_due'].includes(billing.plan_status)?billing.current_period_ends_at:null,
    unavailable:{...(!observed?{invoices:'NOT_SYNCED'}:{}),...(observed&&Number(invoices?.month_observed??0)===0?{thisMonthBilledYen:'NOT_OBSERVED_THIS_MONTH'}:{}),contractAccountCount:'NO_PER_ACCOUNT_CONTRACTS',paymentFailureCount:'NO_PER_INVOICE_FAILURE_STATE'}};
}
