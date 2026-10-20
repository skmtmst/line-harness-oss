import { fetchApi } from './transport/request'
import type { BookingSyncRules, BookingSyncRulesInput, BookingSyncNotice } from '@line-crm/shared'

export const bookingSyncApi = {
  rules: (accountId:string)=>fetchApi<{success:true;data:BookingSyncRules}>(`/api/booking/admin/sync-rules?account_id=${encodeURIComponent(accountId)}`),
  saveRules: (accountId:string,body:BookingSyncRulesInput)=>fetchApi<{success:true;data:BookingSyncRules}>(`/api/booking/admin/sync-rules?account_id=${encodeURIComponent(accountId)}`,{method:'PUT',body:JSON.stringify(body)}),
  notices: (accountId:string)=>fetchApi<{success:true;data:BookingSyncNotice[]}>(`/api/booking/admin/sync-notices?account_id=${encodeURIComponent(accountId)}`),
  completeNotice: (accountId:string,id:string)=>fetchApi<{success:true;data:{id:string;status:'done'}}>(`/api/booking/admin/sync-notices/${encodeURIComponent(id)}/done?account_id=${encodeURIComponent(accountId)}`,{method:'POST'}),
};
