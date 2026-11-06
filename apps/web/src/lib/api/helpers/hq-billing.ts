import { fetchApi } from '../../api'

export async function fetchHqBillingMetrics() {
  return fetchApi<{success:boolean;data:{period:{from?:string;until?:string};unavailable:Record<string,string>;thisMonthBilledYen:number|null;contractCount:number;contractUnit:'organization';activeAccountCount:number;contractAccountCount:null;trialCount:number;unpaidInvoiceCount:number|null;paymentFailureCount:null;nextBillingAt:string|null;source:'stored_invoices';observedInvoiceCount:number;lastSyncedAt:string|null}}>(`/api/hq/billing/metrics`)
}
