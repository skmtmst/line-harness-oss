import { fetchApi } from '../../api'
import type { HqTemplateArchiveCounts, HqTemplateArchiveStatus, HqTemplateListDisplay } from '@line-crm/shared'

type HqArchiveTemplateType = 'tag' | 'friend_field' | 'mark' | 'template' | 'rich_menu' | 'form' | 'scenario' | 'auto_reply' | 'friend_add_rule' | 'reminder' | 'booking_menu' | 'mileage_reward'
export interface HqArchiveTemplate extends HqTemplateListDisplay {
  id: string; name: string; description: string | null; template_type: HqArchiveTemplateType
  revision: number; folder_id: string | null; updated_at: string; archived_at: string | null
}
export interface HqArchiveList {
  success: boolean; data: HqArchiveTemplate[]; status: HqTemplateArchiveStatus
  archive_counts: HqTemplateArchiveCounts
}
const base = '/api/hq/templates'
/** The list/counts share the same type/kind. Restoring never republishes or distributes. */
export const hqTemplateArchiveApi = {
  list: (input: {type?: HqArchiveTemplateType; kind?: string; status?: HqTemplateArchiveStatus} = {}) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(input)) if (value !== undefined) query.set(key, value)
    return fetchApi<HqArchiveList>(`${base}${query.size ? `?${query}` : ''}`, {method: 'GET'})
  },
  archive: (id: string, expectedRevision: number) => fetchApi<{success: boolean; data: {id: string; archived: true}}>(`${base}/${encodeURIComponent(id)}`, {method: 'DELETE', body: JSON.stringify({expectedRevision})}),
  restore: (id: string, expectedRevision: number) => fetchApi<{success: boolean; data: {id: string; archived: false; revision: number}}>(`${base}/${encodeURIComponent(id)}/restore`, {method: 'POST', body: JSON.stringify({expectedRevision})}),
}
