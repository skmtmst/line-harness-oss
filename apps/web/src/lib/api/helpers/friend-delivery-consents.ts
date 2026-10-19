import { fetchApi } from '../../api';
import type { ApiResponse } from '@line-crm/shared';
export interface FriendDeliveryConsent {
  purpose:string; state:'granted'|'unknown'|'revoked'; reason:string; source:string;
  updatedBy:string|null; updatedAt:string; version:number;
}
export const friendDeliveryConsentsApi={
  list:(friendId:string)=>fetchApi<ApiResponse<FriendDeliveryConsent[]>>(`/api/friends/${encodeURIComponent(friendId)}/delivery-consents`),
  save:(friendId:string,purpose:string,body:{state:FriendDeliveryConsent['state'];reason:string;expectedVersion:number})=>
    fetchApi<ApiResponse<FriendDeliveryConsent[]>>(`/api/friends/${encodeURIComponent(friendId)}/delivery-consents/${encodeURIComponent(purpose)}`,{method:'PUT',body:JSON.stringify(body)}),
};

export interface FriendDeliveryConsentEvent {
  id:number; purpose:string; operation:'insert'|'update'|'delete';
  before:Omit<FriendDeliveryConsent,'purpose'>|null; after:Omit<FriendDeliveryConsent,'purpose'>|null;
  actor:{kind:'self'|'store'|'system'|'unknown';id:string|null}; reason:string|null; createdAt:string;
}
export const friendDeliveryConsentHistoryApi={
  list:(friendId:string,filters:{purpose?:string;cursor?:string;limit?:10|20|50}={})=>{
    const q=new URLSearchParams();for(const [key,value]of Object.entries(filters))if(value!==undefined)q.set(key,String(value));
    return fetchApi<ApiResponse<{items:FriendDeliveryConsentEvent[];total:number;nextCursor:string|null}>>(`/api/friends/${encodeURIComponent(friendId)}/delivery-consents/history${q.size?'?'+q:''}`);
  },
};
