import type { BookingEntitlement, BookingEntitlementGrant, BookingEntitlementOperation, BookingEntitlementView, BookingEntitlementEvent } from '@line-crm/shared';
import { fetchApi } from '../../api';
type Result<T>={success:true;data:T};
export interface LiffBookingEntitlement {
  id:string;name:string;kind:'ticket'|'monthly';menuId:string|null;remaining:number|null;monthlyLimit:number|null;
  monthUsed:number;monthAllowance:number|null;monthRemaining:number|null;validFrom:string;expiresAt:string;periodStart:string;periodEnd:string;usable:boolean;
}
const root='/api/booking/admin/entitlements';
const query=(accountId:string)=>`account_id=${encodeURIComponent(accountId)}`;
export const bookingEntitlementsApi={
  list:(accountId:string,friendId:string)=>fetchApi<Result<BookingEntitlementView[]>>(`${root}?${query(accountId)}&friend_id=${encodeURIComponent(friendId)}`),
  grant:(accountId:string,input:BookingEntitlementGrant,key:string)=>fetchApi<Result<BookingEntitlement>>(`${root}?${query(accountId)}`,{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(input)}),
  operate:(accountId:string,id:string,input:BookingEntitlementOperation,key:string)=>fetchApi<Result<BookingEntitlement>>(`${root}/${encodeURIComponent(id)}/operations?${query(accountId)}`,{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(input)}),
  history:(accountId:string,id:string,offset=0)=>fetchApi<Result<BookingEntitlementEvent[]>>(`${root}/${encodeURIComponent(id)}/history?${query(accountId)}&offset=${offset}`),
  mine:(liffId:string,idToken:string,options?:{menuId?:string;eventId?:string;startsAt?:string})=>{
    const params=new URLSearchParams({liffId,...(options?.eventId?{event_id:options.eventId}:{}),...(options?.menuId?{menu_id:options.menuId}:{}),...(options?.startsAt?{starts_at:options.startsAt}:{})});
    return fetchApi<Result<LiffBookingEntitlement[]>>(`/api/liff/booking/entitlements?${params}`,{headers:{Authorization:`Bearer ${idToken}`}});
  },
  requestBooking:(liffId:string,idToken:string,key:string,input:{menu_id:string;staff_id:string;starts_at:string;customer_note?:string;entitlement_id?:string;payment_method?:'onsite'|'online'})=>
    fetchApi<{booking_id:string;status:string;payment_required:boolean}>(`/api/liff/booking/requests?liffId=${encodeURIComponent(liffId)}`,{method:'POST',headers:{Authorization:`Bearer ${idToken}`,'Idempotency-Key':key},body:JSON.stringify(input)}),
};
