import { fetchApi } from './api';
import type { HqDeliveryTemplateDefinition, HqDeliveryTemplateType, HqTemplateListDisplay, HqDeliveryTemplateInput } from '@line-crm/shared';
import type { Preflight, Resolution, DistributionResult } from './hq-templates-api';
export type HqDeliveryTemplate = { id:string;name:string;description:string|null;template_type:HqDeliveryTemplateType;revision:number;folder_id?:string|null } & HqTemplateListDisplay;
export interface HqDeliveryTemplateDetail { template:HqDeliveryTemplate;definition:HqDeliveryTemplateDefinition }
async function request<T>(path:string,method='GET',body?:unknown):Promise<T> {
  const result=await fetchApi<{success:true;data:T}|{success:false;error:string;code?:string}>(`/api/hq/templates${path}`,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!result.success) throw new Error(result.error);
  return result.data;
}
const path=(id:string)=>`/${encodeURIComponent(id)}`;
/** 保存したあとに配布先を選び、preflight の確認結果に従って配る。 */
export const hqDeliveriesApi={
  list:(type:HqDeliveryTemplateType)=>request<HqDeliveryTemplate[]>(`?type=${type}`),
  detail:(id:string)=>request<HqDeliveryTemplateDetail>(path(id)),
  create:(input:HqDeliveryTemplateInput)=>request<HqDeliveryTemplateDetail>('', 'POST',input),
  update:(id:string,input:{name:string;description?:string;folderId?:string|null;definition:HqDeliveryTemplateDefinition;expectedRevision:number})=>request<HqDeliveryTemplateDetail>(path(id),'PATCH',input),
  preflight:(id:string,accountIds:string[])=>request<Preflight>(`${path(id)}/preflight`,'POST',{accountIds}),
  distribute:(id:string,preflightId:string,resolutions:Resolution[])=>request<DistributionResult>(`${path(id)}/distribute`,'POST',{preflightId,resolutions}),
  result:(id:string,runId:string)=>request<DistributionResult>(`${path(id)}/distributions/${encodeURIComponent(runId)}`),
  receivedVersions:(id:string)=>request<Array<{accountId:string;accountName:string;receivedAt:string|null;targetVersion:import('@line-crm/shared').HqTemplateTargetVersion}>>(`${path(id)}/received-versions`),
};
