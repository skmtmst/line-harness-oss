import type { HqSupportKind, HqSupportStatus } from '@/lib/hq-support'

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

/** 絵の種類の言葉（`b8xBtZ`・`OhguS`：「不具合」「料金」）。受け口の言葉（「不具合の報告」など）は長く、表の列で切れるので短くする。 */
export const SUPPORT_KIND_WORDS: Record<HqSupportKind, string> = {
  usage: '使い方',
  bug: '不具合',
  billing: '料金',
  feature: '要望',
  other: 'その他',
}

/** 種類の短い言葉。知らない種類は受け口の言葉のまま。 */
export function supportKindWord(kind: string | null | undefined, fallback: string): string {
  return (kind && SUPPORT_KIND_WORDS[kind as HqSupportKind]) || fallback
}
