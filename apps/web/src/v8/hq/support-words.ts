import type { HqSupportStatus } from '@/lib/hq-support'

/** 絵の言葉（`b8xBtZ`・`OhguS`）。運営が見ている間は「対応中」、閉じたら「解決済み」。 */
export const SUPPORT_STATUS_WORDS: Record<HqSupportStatus, string> = {
  open: '対応中',
  answered: '回答済み',
  closed: '解決済み',
}

/** 「9/30 11:00」（日本時間）。読めない値は「—」。 */
export function supportTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('month')}/${pick('day')} ${pick('hour')}:${pick('minute')}`
}
