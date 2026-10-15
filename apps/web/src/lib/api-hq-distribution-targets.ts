import { fetchApi } from './api'
import type { HqTemplateTargetVersion } from '@line-crm/shared'
export interface HqDistributionTargets {
  templateId:string; latestVersion:number; requiresPreflight:true
  stores:Array<{accountId:string;accountName:string;targetVersion:HqTemplateTargetVersion}>
}
export const fetchHqDistributionTargets=(id:string,accountIds:string[]=[])=>fetchApi<{success:true;data:HqDistributionTargets}>(`/api/hq/templates/${encodeURIComponent(id)}/distribution-targets${accountIds.length?`?${new URLSearchParams({accountIds:accountIds.join(',')})}`:''}`)
