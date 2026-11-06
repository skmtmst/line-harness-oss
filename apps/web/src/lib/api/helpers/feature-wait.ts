import { fetchApi } from '../../api'
import type { HqTemplateListDisplay } from '@line-crm/shared'

export interface HqMessageListItem extends HqTemplateListDisplay {
  id: string
  name: string
  revision: number
}
export interface HqMarkListStats {
  supportStatus: {
    source: 'chats'
    friendCount: number
    unhandledFriendCount: number
    inProgressFriendCount: number
    unhandledPercent: number | null
  }
  markChanges: {
    source: 'operation_audit'
    count: number
    coverage: 'recorded_events_only'
    since: string
    until: string
  }
  scope: 'active_accounts_visible_friends'
  updatedAt: string
}

/** Counts come from the saved HQ version; these switches never send a message. */
export function listHqMessageTemplates(filters: HqTemplateViewFilters = {}) {
  const query = new URLSearchParams({ type: 'template', kind: filters.kind ?? 'message' })
  if (filters.messageCount !== undefined) query.set('message_count', filters.messageCount)
  if (filters.hasInterpolations !== undefined) query.set('has_interpolations', String(filters.hasInterpolations))
  if (filters.search !== undefined) query.set('search', filters.search)
  if (filters.folderId !== undefined) query.set('folder_id', filters.folderId ?? '')
  if (filters.undistributed !== undefined) query.set('undistributed', String(filters.undistributed))
  return fetchApi<{ success: true; data: HqMessageListItem[] }>(`/api/hq/templates?${query}`)
}

/** Inbox states and free-form mark assignments must have different labels. */
export function fetchHqMarkListStats() {
  return fetchApi<{ success: true; data: Array<HqTemplateListDisplay & { id: string; name: string }>; stats: HqMarkListStats }>('/api/hq/templates?type=mark')
}

export interface HqTemplateViewFilters {
  kind?: import('@line-crm/shared').TemplateKind
  messageCount?: 'single' | 'multiple'
  hasInterpolations?: boolean
  undistributed?: boolean
  search?: string
  folderId?: string | null
}
export interface HqTemplateSavedView {
  id: string
  name: string
  owner_staff_id: string
  scope: 'personal' | 'tenant'
  revision: number
  filters: HqTemplateViewFilters
  created_at: string
  updated_at: string
}
export const hqTemplateSavedViewsApi = {
  list: () => fetchApi<{success:true;data:HqTemplateSavedView[]}>('/api/hq/templates/saved-views'),
  create: (input:{name:string;filters:HqTemplateViewFilters;scope?:'personal'|'tenant'}) => fetchApi<{success:true;data:HqTemplateSavedView}>('/api/hq/templates/saved-views',{method:'POST',body:JSON.stringify(input)}),
  update: (id:string,input:{name:string;filters:HqTemplateViewFilters;scope:'personal'|'tenant';expectedRevision:number}) => fetchApi<{success:true;data:HqTemplateSavedView}>(`/api/hq/templates/saved-views/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input)}),
  archive: (id:string,expectedRevision:number) => fetchApi<{success:true;data:{id:string;archived:true}}>(`/api/hq/templates/saved-views/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify({expectedRevision})}),
}
export function updateSupportMarkDisplayLocations(id:string,accountId:string,expectedVersion:number,displayLocations:import('@line-crm/shared').SupportMarkLocation[]) {
  return fetchApi<{success:true;data:import('@line-crm/shared').SupportMark}>(`/api/support-marks/${encodeURIComponent(id)}?lineAccountId=${encodeURIComponent(accountId)}`,{method:'PATCH',body:JSON.stringify({expectedVersion,displayLocations})})
}
