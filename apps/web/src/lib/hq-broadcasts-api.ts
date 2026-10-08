import { fetchApi } from './api';
import type { HqBroadcastInput,HqBroadcastDraftInput,HqBroadcastRun,HqBroadcastPreflight } from '@line-crm/shared';
type Response<T>={success:true;data:T};
const path=(s:string)=>`/api/hq/broadcasts${s}`;
const send=<T>(s:string,body:unknown,confirmed=false,method='POST')=>fetchApi<Response<T>>(path(s),{method,body:JSON.stringify(body),...(confirmed?{headers:{'X-Confirm-Irreversible':'broadcast-send'}}:{})});
export const hqBroadcastsApi={
 list:()=>fetchApi<Response<HqBroadcastRun[]>>(path('')),
 create:(body:HqBroadcastInput)=>send<HqBroadcastRun>('',body),
 get:(id:string)=>fetchApi<Response<HqBroadcastRun>>(path(`/${encodeURIComponent(id)}`)),
 update:(id:string,body:HqBroadcastDraftInput)=>send<HqBroadcastRun>(`/${encodeURIComponent(id)}`,body,false,'PATCH'),
 preflight:(id:string)=>send<HqBroadcastPreflight[]>(`/${encodeURIComponent(id)}/preflight`,{}),
 exclude:(id:string,accountIds:string[],expectedVersion:number)=>send<HqBroadcastRun>(`/${encodeURIComponent(id)}/exclusions`,{accountIds,expectedVersion},false,'PUT'),
 send:(id:string,expectedVersion:number,confirmedRecipientCount?:number)=>send<HqBroadcastRun>(`/${encodeURIComponent(id)}/send`,{expectedVersion,confirmedRecipientCount},true),
 stop:(id:string,expectedVersion:number)=>send<HqBroadcastRun>(`/${encodeURIComponent(id)}/stop`,{expectedVersion}),
 cancel:(id:string,expectedVersion:number)=>send<HqBroadcastRun>(`/${encodeURIComponent(id)}/cancel`,{expectedVersion}),
 folders:()=>fetchApi<Response<Array<{id:string;name:string;revision:number;item_count:number}>>>(path('/folders')),
 createFolder:(name:string)=>send<{id:string;name:string;revision:number}>('/folders',{name}),
 updateFolder:(id:string,name:string,expectedVersion:number)=>send<{id:string;name:string;revision:number}>(`/folders/${encodeURIComponent(id)}`,{name,expectedVersion},false,'PATCH'),
 deleteFolder:(id:string,expectedVersion:number)=>send<{id:string;archived:boolean}>(`/folders/${encodeURIComponent(id)}`,{expectedVersion},false,'DELETE'),
 approval:(id:string)=>fetchApi<Response<import('@line-crm/shared').BroadcastApprovalState>>(path(`/${encodeURIComponent(id)}/approval`)),
 approvalCandidates:()=>fetchApi<Response<Array<{id:string;name:string;role:string;canApprove:boolean}>>>(path('/approvals/candidates')),
 requestApproval:(id:string,expectedVersion:number,approverStaffId:string,note?:string)=>send<import('@line-crm/shared').BroadcastApprovalState>(`/${encodeURIComponent(id)}/approval-request`,{expectedVersion,approverStaffId,note}),
 approve:(id:string,expectedVersion:number,stepUpToken?:string)=>fetchApi<Response<import('@line-crm/shared').BroadcastApprovalState>>(path(`/${encodeURIComponent(id)}/approve`),{method:'POST',body:JSON.stringify({expectedVersion}),...(stepUpToken?{headers:{'X-Step-Up-Token':stepUpToken}}:{})}),
 reject:(id:string,expectedVersion:number,reason:string)=>send<import('@line-crm/shared').BroadcastApprovalState>(`/${encodeURIComponent(id)}/reject`,{expectedVersion,reason}),
 cancelApproval:(id:string,expectedVersion:number)=>send<import('@line-crm/shared').BroadcastApprovalState>(`/${encodeURIComponent(id)}/approval-cancel`,{expectedVersion}),
 testSend:(id:string,accountId:string)=>send<{sent:number;failed:number}>(`/${encodeURIComponent(id)}/test-send`,{accountId}),
 recipients:(id:string,accountId:string,cursor=0,limit=50)=>fetchApi<Response<{rows:Array<{friendId:string;displayName:string|null;state:string;attemptNo:number;sentAt:string|null;claimedAt:string;errorCode:string|null}>;total:number;nextCursor:string|null}>>(path(`/${encodeURIComponent(id)}/targets/${encodeURIComponent(accountId)}/recipients?cursor=${cursor}&limit=${limit}`)),
 activity:(id:string,cursor=0,limit=50)=>fetchApi<Response<{rows:Array<{id:string;accountId:string;actorId:string;action:string;createdAt:string}>;nextCursor:string|null}>>(path(`/${encodeURIComponent(id)}/activity?cursor=${cursor}&limit=${limit}`)),
 exportPath:(id:string)=>path(`/${encodeURIComponent(id)}/export.csv`),
 retry:(id:string,accountId:string,expectedVersion:number)=>send<HqBroadcastRun>(`/${encodeURIComponent(id)}/targets/${encodeURIComponent(accountId)}/retry`,{expectedVersion},true),
};
