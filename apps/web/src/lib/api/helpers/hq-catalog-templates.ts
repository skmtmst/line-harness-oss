import { fetchApi } from '../../api'
import type { HqCatalogTemplateDefinition,HqCatalogTemplateType } from '@line-crm/shared'
import type { Preflight,Resolution,DistributionResult } from '../../hq-templates-api'
type Detail={template:{id:string;template_type:HqCatalogTemplateType;name:string;revision:number};definition:HqCatalogTemplateDefinition}
export type CatalogRedistributionPreview={templateVersionId:string;expiresAt:string;stores:Array<{accountId:string;accountName:string;targetId:string;snapshot:string;preflightId:string;state:'current'|'update'|'approval_required'|'kept'}>}
const base='/api/hq/templates'
export const hqCatalogTemplatesApi={
 list:(type:HqCatalogTemplateType)=>fetchApi<{success:true;data:Detail['template'][]}>(`${base}?type=${type}`),
 detail:(id:string)=>fetchApi<{success:true;data:Detail}>(`${base}/${encodeURIComponent(id)}`),
 create:(input:{type:HqCatalogTemplateType;name:string;definition:HqCatalogTemplateDefinition;requestId:string;folderId?:string|null})=>fetchApi<{success:true;data:Detail}>(base,{method:'POST',body:JSON.stringify(input)}),
 update:(id:string,input:{name:string;definition:HqCatalogTemplateDefinition;expectedRevision:number;folderId?:string|null})=>fetchApi<{success:true;data:Detail}>(`${base}/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input)}),
 preflight:(id:string,accountIds:string[])=>fetchApi<{success:true;data:Preflight}>(`${base}/${encodeURIComponent(id)}/preflight`,{method:'POST',body:JSON.stringify({accountIds})}),
 distribute:(id:string,preflightId:string,resolutions:Resolution[])=>fetchApi<{success:true;data:DistributionResult}>(`${base}/${encodeURIComponent(id)}/distribute`,{method:'POST',body:JSON.stringify({preflightId,resolutions})}),
 redistributionPreview:(id:string,accountIds:string[])=>fetchApi<{success:true;data:CatalogRedistributionPreview}>(`${base}/${encodeURIComponent(id)}/catalog-redistribution-preview`,{method:'POST',body:JSON.stringify({accountIds})}),
 redistribute:(id:string,preview:CatalogRedistributionPreview)=>fetchApi<{success:true;data:{stores:Array<{accountId:string;status:string}>}}>(`${base}/${encodeURIComponent(id)}/catalog-redistribution`,{method:'POST',body:JSON.stringify({templateVersionId:preview.templateVersionId,stores:preview.stores.map(({accountId,snapshot,preflightId})=>({accountId,snapshot,preflightId}))})}),
}
