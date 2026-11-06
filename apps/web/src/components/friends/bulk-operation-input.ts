import type { FriendBulkOperation } from '@line-crm/shared'
import { datetimeLocalJstToUtcIso } from '@/lib/jst-datetime'

export type BulkOperationInput = {
  resourceId: string
  resourceName: string
  versionId: string
  content: string
  targetDate: string
}

export const EMPTY_BULK_INPUT: BulkOperationInput = {
  resourceId: '', resourceName: '', versionId: '', content: '', targetDate: '',
}

/** 未入力を「解除」と取り違えない。日時は端末の地域によらず日本時間で送る。 */
export function buildBulkOperation(kind: FriendBulkOperation['kind'], input: BulkOperationInput): FriendBulkOperation | null {
  const id = input.resourceId
  switch (kind) {
    case 'add_tag':
    case 'remove_tag': return id ? { kind, tagId: id } : null
    case 'assign_operator': return id ? { kind, operatorId: id === '__none' ? null : id } : null
    case 'start_scenario':
    case 'stop_scenario': return id ? { kind, scenarioId: id } : null
    case 'set_support': return id ? { kind, markId: id === '__none' ? null : id } : null
    case 'set_reminder': {
      if (!id || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.targetDate)) return null
      try {
        return { kind, reminderId: id, targetDate: datetimeLocalJstToUtcIso(input.targetDate) }
      } catch { return null }
    }
    case 'send_message': return input.content.trim() && input.content.length <= 5000
      ? { kind, content: input.content, messageType: 'text' } : null
    case 'run_common_action': return id && input.versionId
      ? { kind, commonActionId: id, commonActionVersionId: input.versionId } : null
    default: return null
  }
}
