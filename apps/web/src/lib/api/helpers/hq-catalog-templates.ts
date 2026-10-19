import { fetchApi } from '../../api'
import type { HqCatalogTemplateDefinition,HqCatalogTemplateType } from '@line-crm/shared'
import type { Preflight,Resolution,DistributionResult } from '../../hq-templates-api'
type Detail={template:{id:string;template_type:HqCatalogTemplateType;name:string;revision:number};definition:HqCatalogTemplateDefinition}
const base='/api/hq/templates'
export const hqCatalogTemplatesApi={
 list:(type:HqCatalogTemplateType)=>fetchApi<{success:true;data:Detail['template'][]}>(`${base}?type=${type}`),
 detail:(id:string)=>fetchApi<{success:true;data:Detail}>(`${base}/${encodeURIComponent(id)}`),
 create:(input:{type:HqCatalogTemplateType;name:string;definition:HqCatalogTemplateDefinition;requestId:string;folderId?:string|null})=>fetchApi<{success:true;data:Detail}>(base,{method:'POST',body:JSON.stringify(input)}),
 update:(id:string,input:{name:string;definition:HqCatalogTemplateDefinition;expectedRevision:number;folderId?:string|null})=>fetchApi<{success:true;data:Detail}>(`${base}/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input)}),
 preflight:(id:string,accountIds:string[])=>fetchApi<{success:true;data:Preflight}>(`${base}/${encodeURIComponent(id)}/preflight`,{method:'POST',body:JSON.stringify({accountIds})}),
 distribute:(id:string,preflightId:string,resolutions:Resolution[])=>fetchApi<{success:true;data:DistributionResult}>(`${base}/${encodeURIComponent(id)}/distribute`,{method:'POST',body:JSON.stringify({preflightId,resolutions})}),
}
