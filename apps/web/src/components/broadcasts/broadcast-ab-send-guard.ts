import { formatNumber } from '@/lib/format'
import { AB_MIN_TOTAL } from '@/v8/broadcast-ab/public/settings/index'

/** 実送信の受け口ができるまで、模擬送信を通常の送信として実行しない。 */
export function broadcastAbSendProblem(enabled: boolean, count: number | null): string | null {
  if (!enabled) return null
  if (count === null || !Number.isFinite(count)) return 'A/Bは送信に使えず、人数も未確定です。③でB案を消し、人数を確認してください。'
  if (count < AB_MIN_TOTAL) return `A/Bは送信未対応です（条件${formatNumber(AB_MIN_TOTAL)}人以上、現在${formatNumber(count)}人）。③でB案を消すとA案を配信できます。`
  return 'A/Bは送信未対応です。③でB案を消すとA案を配信できます。'
}
