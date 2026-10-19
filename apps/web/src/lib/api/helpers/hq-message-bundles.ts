import { fetchApi } from '../../api'
import type { MessageTemplateDefinition } from '@line-crm/shared'
/** Same immutable version, account preflight and distribution as single-message templates. */
export function saveHqMessageTemplate(input:{name:string;definition:MessageTemplateDefinition;description?:string;folderId?:string|null}&({id?:undefined;requestId:string}|{id:string;expectedRevision:number})) {
 const {id,...body}=input
 return fetchApi<{success:true;data:{template:{id:string;revision:number};definition:MessageTemplateDefinition}}>(`/api/hq/templates${id?`/${encodeURIComponent(id)}`:''}`,{method:id?'PATCH':'POST',body:JSON.stringify({type:'template',...body})})
}
