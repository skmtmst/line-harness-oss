import { fetchApi } from '../../api'
export interface HqResourceSearchResult {kind:'tag'|'coupon'|'scenario';items:Array<{id:string;name:string;accountId:string;accountName:string}>;total:number;nextCursor:string|null}
export function searchHqTemplateResources(input:{kind:HqResourceSearchResult['kind'];q?:string;accountIds?:string[];limit?:number;cursor?:string}) {
 const query=new URLSearchParams({kind:input.kind})
 if(input.accountIds?.length)query.set('accountIds',input.accountIds.join(','))
 for(const key of ['q','limit','cursor'] as const)if(input[key]!==undefined)query.set(key,String(input[key]))
 return fetchApi<{success:true;data:HqResourceSearchResult}>(`/api/hq/templates/resources?${query}`)
}
