/** 分数を、長い待ち時間でも読みやすい「日・時間・分」に直す。 */
export function formatDurationMinutes(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes))
  const days = Math.floor(total / 1_440)
  const hours = Math.floor((total % 1_440) / 60)
  const restMinutes = total % 60

  if (days > 0) {
    return `${days}日${hours > 0 ? `${hours}時間` : ''}${restMinutes > 0 ? `${restMinutes}分` : ''}`
  }
  if (hours > 0) {
    return `${hours}時間${restMinutes > 0 ? `${restMinutes}分` : ''}`
  }
  return `${restMinutes}分`
}
