import type { MergedPersonDetail, MergedPersonDeliveryPriority, MergedPersonLinkedFriend, MergedPersonProfileValue } from '@line-crm/shared'
import { confidenceText, dateText, groupByPurpose, purposeText, sourceText, statusText, updateModeText } from './merged-person-view'

export function profileValueDetails(value: MergedPersonProfileValue): string {
  return `${sourceText(value.sourceType)}（${value.sourceLabel}）／${updateModeText(value.updateMode)}／${value.verifiedAt ? `確認済み ${dateText(value.verifiedAt)}` : '未確認'}／${value.selectedByName} が ${dateText(value.selectedAt)} に採用`
}

export function personDetails(person: MergedPersonDetail): string {
  const linked = person.history.find((item) => item.eventType === 'link')
  return `${statusText(person.status)}／まとめた日時：${dateText(person.createdAt)}／最後の変更：${dateText(person.updatedAt)}／担当：${linked?.actorName ?? '—'}／読み込んだ版：第${person.revision}版／採用した属性：${person.profileValues.length}件`
}

export function linkedFriendDetails(friend: MergedPersonLinkedFriend): string {
  return `${friend.isFollowing ? '友だち' : 'ブロック中'}／確からしさ ${confidenceText(friend.confidence)}／結び付けた日時 ${dateText(friend.linkedAt)}`
}

export function deliveryPriorityDetails(priorities: MergedPersonDeliveryPriority[]): string {
  if (!priorities.length) return '優先順はまだ決めていません。用途ごとに配信元を選べます。'
  return groupByPurpose(priorities).map((group) => `${purposeText(group.purpose)}：${group.rows.map((row) => `${row.priority}位 ${row.lineAccountName} ${row.isActive ? '使う' : '使わない'} ${row.reason}`).join('／')}`).join('、')
}
