import { fetchApi } from './api';
import type { VisitStampCard,VisitStampCardInput,VisitStampWallet,VisitStampEntry } from '@line-crm/shared';
type Response<T>={success:true;data:T};
const path=(s:string)=>`/api/visit-stamps${s}`;
const send=<T>(s:string,method:string,body:unknown)=>fetchApi<Response<T>>(path(s),{method,body:JSON.stringify(body)});
export const visitStampsApi={
 cards:()=>fetchApi<Response<VisitStampCard[]>>(path('/cards')),
 create:(body:VisitStampCardInput)=>send<VisitStampCard>('/cards','POST',body),
 save:(id:string,body:VisitStampCardInput)=>send<VisitStampCard>(`/cards/${encodeURIComponent(id)}`,'PUT',body),
 wallet:(id:string,accountId:string,friendId:string)=>fetchApi<Response<{wallet:VisitStampWallet;entries:VisitStampEntry[]}>>(path(`/cards/${encodeURIComponent(id)}/wallet?${new URLSearchParams({accountId,friendId})}`)),
 grant:(id:string,body:{accountId:string;friendId:string;count:number;reason:string;requestId:string;source?:'manual'|'paper'})=>send<VisitStampWallet>(`/cards/${encodeURIComponent(id)}/grants`,'POST',body),
 reverse:(id:string,reason:string)=>send<VisitStampWallet>(`/entries/${encodeURIComponent(id)}/reverse`,'POST',{reason}),
 setPin:(staffId:string,accountId:string,pin:string)=>send<{staffId:string;accountId:string;configured:true}>(`/pins/${encodeURIComponent(staffId)}`,'PUT',{accountId,pin}),
 paperRequests:(accountId:string)=>fetchApi<Response<Array<{id:string;photo_url:string;stamps:number;status:string}>>>(path(`/paper-requests?${new URLSearchParams({accountId})}`)),
 reviewPaper:(id:string,action:'approve'|'reject',reason:string)=>send<{id:string;status:string}>(`/paper-requests/${encodeURIComponent(id)}/review`,'POST',{action,reason}),
 checkout:(kind:'restaurant'|'booking',id:string,amount:number)=>send<{visitId:string;amount:number;recorded:true}>(`/visits/${kind}/${encodeURIComponent(id)}/checkout`,'POST',{amount}),
};
