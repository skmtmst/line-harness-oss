import { fetchApi } from './api'
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
export function listHqMessageTemplates(filters: { messageCount?: 'single' | 'multiple'; hasInterpolations?: boolean } = {}) {
  const query = new URLSearchParams({ type: 'template', kind: 'message' })
  if (filters.messageCount !== undefined) query.set('message_count', filters.messageCount)
  if (filters.hasInterpolations !== undefined) query.set('has_interpolations', String(filters.hasInterpolations))
  return fetchApi<{ success: true; data: HqMessageListItem[] }>(`/api/hq/templates?${query}`)
}

/** Inbox states and free-form mark assignments must have different labels. */
export function fetchHqMarkListStats() {
  return fetchApi<{ success: true; data: Array<HqTemplateListDisplay & { id: string; name: string }>; stats: HqMarkListStats }>('/api/hq/templates?type=mark')
}
