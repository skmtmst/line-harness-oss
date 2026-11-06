import { parseEventQuestions } from '@/components/events/event-questions-editor'
import { type EventDetail } from '@/lib/api'
import { formatDateTime,formatDay,formatTime } from '@/lib/format'



export function formatJpDateTime(iso: string): string {
  const d = new Date(iso)
  /*
    EVENT-05: 一覧(app/events/page.tsx)は Asia/Tokyo 固定で出す。
    ここが端末の時間帯に依存すると、同じ開催回が一覧と編集で
    時差分ずれて見える。保存値(UTC)は変えず、表示だけ日本時間に固定する。
  */
  return formatDateTime(d)
}


/**
 * 枠の日時の出し方。「2026/09/20 23:30 〜 01:00」。
 *
 * 日をまたぐ枠は終了側の日付も出す(DETAIL-10)。時刻だけにすると
 * 「9/20 23:30〜01:00」が当日深夜なのか翌日なのか読めない。
 */
export function formatJpSlotRange(startsAt: string, endsAt: string): string {
  const start = formatJpDateTime(startsAt)
  const end = formatJpDateTime(endsAt)
  const sameDay = formatDay(startsAt) === formatDay(endsAt)
  return `${start} 〜 ${sameDay ? formatTime(endsAt) : end}`
}


/**
 * 保存・読込の応答を draft の形へ戻す（R82）。
 *
 * Worker は質問の定義を questions_json の文字列で返す。ほぐさず
 * `setDraft` すると questions が消え、次の保存で questions:null を送って
 * 定義ごと消してしまう。読み込み時と同じほぐし方を保存後にも使う。
 */
export function toEventDraft(row: EventDetail): EventDetail {
  return { ...row, questions: parseEventQuestions(row.questions_json) }
}
