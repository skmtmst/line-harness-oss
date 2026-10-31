/** 予約の窓で、送るものと日時がそろうまで同じ理由を表示する。 */
export function scheduledMessageInputReason(content: string, hasAttachment: boolean, scheduledAt: string): string | undefined {
  if (!content.trim() && !hasAttachment) return '送るものを入力してください'
  if (!scheduledAt) return '送る日時を選んでください'
  return undefined
}
