/*
 * ★V8 受信箱の一覧の時刻（M0393 XqSvX：「2時間前」「昨日」「8月16日」）。
 * 日本時間の暦で数える。曜日は付けない（行の右上に収める）。年が違うときだけ年を付ける。
 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const dayIndex = (epoch: number) => Math.floor((epoch + JST_OFFSET_MS) / 86_400_000)

export function formatInboxListTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—'
  const at = new Date(iso)
  const epoch = at.getTime()
  if (Number.isNaN(epoch)) return '—'
  const nowEpoch = now.getTime()
  const diffMin = Math.floor((nowEpoch - epoch) / 60_000)
  const dayDiff = dayIndex(nowEpoch) - dayIndex(epoch)
  const jst = new Date(epoch + JST_OFFSET_MS)
  const dateText = `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`
  if (diffMin < 0) return dateText
  if (dayDiff === 0) {
    if (diffMin < 1) return 'たった今'
    if (diffMin < 60) return `${diffMin}分前`
    return `${Math.floor(diffMin / 60)}時間前`
  }
  if (dayDiff === 1) return '昨日'
  const nowYear = new Date(nowEpoch + JST_OFFSET_MS).getUTCFullYear()
  return jst.getUTCFullYear() === nowYear ? dateText : `${jst.getUTCFullYear()}年${dateText}`
}
