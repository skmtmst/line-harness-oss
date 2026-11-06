import type { MonthlyContractView, MonthlyCycleView } from '@line-crm/shared';
import type { MonthlyScope, MonthlyContractRow } from './types.js';

interface CycleRow {
  contract_id: string; id: string; month_key: string; kind: MonthlyCycleView['kind']; state: MonthlyCycleView['state'];
  due_at: string; service_start: string; service_end: string; amount: number; currency: 'jpy'; paid_at: string | null;
  right_state: MonthlyCycleView['rightState'];
}
/** DTOは許可した項目から作り、カード/口座/同意本文/受信記録をspreadしない。 */
export async function listMonthlyContracts(db: D1Database, scope: MonthlyScope, friendId: string,
  options: { id?: string; limit?: number; offset?: number } = {}): Promise<{ items: MonthlyContractView[]; total: number }> {
  const limit=options.limit??20,offset=options.offset??0;
  if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0) throw new Error('invalid_monthly_pagination');
  const where='tenant_id=? AND account_id=? AND friend_id=? AND (? IS NULL OR id=?)';
  const binds=[scope.tenantId,scope.accountId,friendId,options.id??null,options.id??null];
  const total=await db.prepare(`SELECT count(*) n FROM booking_monthly_contracts WHERE ${where}`).bind(...binds).first<{n:number}>();
  const rows=(await db.prepare(`SELECT * FROM booking_monthly_contracts WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`)
    .bind(...binds,limit,offset).all<MonthlyContractRow>()).results;
  const cycles=rows.length ? (await db.prepare(`SELECT * FROM (
    SELECT y.*,r.state right_state,row_number() OVER(PARTITION BY y.contract_id ORDER BY y.month_key DESC) row_rank
    FROM booking_monthly_cycles y LEFT JOIN booking_monthly_rights r ON r.cycle_id=y.id
    WHERE y.tenant_id=? AND y.account_id=? AND y.contract_id IN (${rows.map(()=>'?').join(',')}))
    WHERE row_rank<=12 ORDER BY month_key DESC,id DESC`).bind(scope.tenantId,scope.accountId,...rows.map(r=>r.id)).all<CycleRow>()).results : [];
  return {total:total?.n??0,items:rows.map(row=>({
    id:row.id,planId:row.plan_id,name:row.name,classKind:row.class_kind,classId:row.class_id,
    amount:row.amount,currency:row.currency,monthlyLimit:row.monthly_limit,timezone:row.timezone,
    state:row.state,serviceState:row.service_state==='review_hold'||row.attention_started_at!==null&&Date.parse(row.attention_started_at)+7*86400000<=Date.now()?'review_hold':'enabled',stopReason:row.stop_reason,stopEffectiveAt:row.stop_effective_at,version:row.version,
    cycles:cycles.filter(y=>y.contract_id===row.id).map(y=>({id:y.id,monthKey:y.month_key,kind:y.kind,state:y.state,
      dueAt:y.due_at,serviceStart:y.service_start,serviceEnd:y.service_end,amount:y.amount,currency:y.currency,paidAt:y.paid_at,rightState:y.right_state})),
  }))};
}

export async function monthlyEntitlementAccess(db: D1Database, accountId: string, entitlementId: string,
  kind: 'menu' | 'event', classId: string | undefined, at: string): Promise<{ reason: 'billing_stopped' | 'expired' | 'menu_out_of_scope' | null } | null> {
  const row=await db.prepare(`SELECT c.class_kind,c.class_id,y.service_start,y.service_end,c.stop_effective_at,v.entitlement_id available
    FROM booking_monthly_rights r JOIN booking_monthly_contracts c ON c.id=r.contract_id
    JOIN booking_monthly_cycles y ON y.id=r.cycle_id LEFT JOIN booking_monthly_available_rights v ON v.entitlement_id=r.entitlement_id
    WHERE r.entitlement_id=? AND r.account_id=?`).bind(entitlementId,accountId)
    .first<{class_kind:string;class_id:string;service_start:string;service_end:string;stop_effective_at:string|null;available:string|null}>();
  if(!row) return null;
  if(row.class_kind!==kind || classId && row.class_id!==classId) return {reason:'menu_out_of_scope'};
  if(Date.parse(at)<Date.parse(row.service_start)||Date.parse(at)>=Date.parse(row.service_end)) return {reason:'expired'};
  if(!row.available || row.stop_effective_at && Date.parse(at)>=Date.parse(row.stop_effective_at)) return {reason:'billing_stopped'};
  return {reason:null};
}
