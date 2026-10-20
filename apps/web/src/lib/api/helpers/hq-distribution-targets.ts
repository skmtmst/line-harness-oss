import { fetchApi } from '../../api'
import type { HqTemplateTargetVersion } from '@line-crm/shared'
export interface HqDistributionTargets {
  templateId:string; latestVersion:number; requiresPreflight:true
  stores:Array<{accountId:string;accountName:string;folderId:string|null;targetVersion:HqTemplateTargetVersion}>
}
export const fetchHqDistributionTargets=(id:string,accountIds:string[]=[])=>fetchApi<{success:true;data:HqDistributionTargets}>(`/api/hq/templates/${encodeURIComponent(id)}/distribution-targets${accountIds.length?`?${new URLSearchParams({accountIds:accountIds.join(',')})}`:''}`)

export const fetchHqDistributionAccounts=()=>fetchApi<{success:true;data:Array<{id:string;name:string;folderId:string|null}>}>('/api/hq/templates/accounts')
