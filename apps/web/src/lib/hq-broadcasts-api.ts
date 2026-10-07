import { fetchApi } from './api';
import type { HqBroadcastInput,HqBroadcastRun,HqBroadcastPreflight } from '@line-crm/shared';
type Response<T>={success:true;data:T};
const path=(s:string)=>`/api/hq/broadcasts${s}`;
const send=<T>(s:string,body:unknown,confirmed=false,method='POST')=>fetchApi<Response<T>>(path(s),{method,body:JSON.stringify(body),...(confirmed?{headers:{'X-Confirm-Irreversible':'broadcast-send'}}:{})});
export const hqBroadcastsApi={
 list:()=>fetchApi<Response<HqBroadcastRun[]>>(path('')),
 create:(body:HqBroadcastInput)=>send<HqBroadcastRun>('',body),
 get:(id:string)=>fetchApi<Response<HqBroadcastRun>>(path(`/${encodeURIComponent(id)}`)),
 preflight:(id:string)=>send<HqBroadcastPreflight[]>(`/${encodeURIComponent(id)}/preflight`,{}),
 exclude:(id:string,accountIds:string[],expectedVersion:number)=>send<HqBroadcastRun>(`/${encodeURIComponent(id)}/exclusions`,{accountIds,expectedVersion},false,'PUT'),
 send:(id:string,expectedVersion:number)=>send<HqBroadcastRun>(`/${encodeURIComponent(id)}/send`,{expectedVersion},true),
 stop:(id:string,expectedVersion:number)=>send<HqBroadcastRun>(`/${encodeURIComponent(id)}/stop`,{expectedVersion}),
 cancel:(id:string,expectedVersion:number)=>send<HqBroadcastRun>(`/${encodeURIComponent(id)}/cancel`,{expectedVersion}),
 retry:(id:string,accountId:string,expectedVersion:number)=>send<HqBroadcastRun>(`/${encodeURIComponent(id)}/targets/${encodeURIComponent(accountId)}/retry`,{expectedVersion},true),
};
