import { fetchApi } from './api';
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
