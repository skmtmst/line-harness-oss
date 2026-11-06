import { fetchApi } from '../../api'
import type { HqBroadcastRun } from '@line-crm/shared'
const base='/api/hq/broadcasts'
export function listHqBroadcasts(params:{from?:string;to?:string;q?:string;status?:'draft'|'pending_approval'|'scheduled'|'sending'|'sent'|'failed'|'stopped'|'cancelled';folderId?:string;limit?:number;cursor?:string;sort?:'newest'|'oldest'}={}) {
  const query=new URLSearchParams()
  for(const [key,value] of Object.entries(params))if(value!==undefined)query.set(key,String(value))
  return fetchApi<{success:boolean;data:Array<HqBroadcastRun & {displayStatus:string;selectable:true}>;pagination:{total:number;limit:number;cursor:number;nextCursor:string|null};statusCounts:Record<string,number>}>(`${base}?${query}`)
}
export function fetchHqBroadcastQuota() {
  return fetchApi<{success:boolean;data:{source:'operation_health_cache';maxAgeSeconds:number;remaining:number|null;used:number|null;limit:number|null;perAccount:Array<{accountId:string;accountName:string;remaining:number|null;used:number|null;limit:number|null;observedAt:string|null;fresh:boolean}>}}>(`${base}/quota`)
}
export function fetchHqBroadcastReactions(id:string) {
  return fetchApi<{success:boolean;data:{windowDays:number;minimumPeople:number;links:Array<{accountId:string;broadcastId:string;linkId:string;label:string;url:string;uniqueClickCount:number|null;clickCount:number|null;clickRate:number|null;suppressed:boolean}>;blockCount:number|null;blockCountState:string;blockCountUnavailableReason:string|null;blocksByAccount:Array<{accountId:string;blockCount:number|null;state:string;reason:string|null;windowComplete:boolean}>}}>(`${base}/${encodeURIComponent(id)}/reactions`)
}
export function copyHqBroadcast(id:string,input:{requestId:string;expectedVersion:number;title?:string},kind:'duplicate'|'followup') {
  return fetchApi<{success:boolean;data:HqBroadcastRun & {sent:0;followupAudience?:Array<{accountId:string;count:number}>;followupAudienceCount?:number}}>(`${base}/${encodeURIComponent(id)}/${kind}`,{method:'POST',body:JSON.stringify(input)})
}
