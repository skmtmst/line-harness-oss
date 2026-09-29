import type { ConversionApprovalItem } from '@/lib/api'
import { STATE_TEXT } from '@/components/shared/not-connected'

/**
 * V6 案件一覧（`GH8VL`）の帯にある「今月の成果」「支払い予定」「付与予定マイル」。
 *
 * この3枚は**承認が済んだ成果だけ**を数える。承認待ちは金額が確定して
 * いないので、支払い予定に入れると払いすぎる。だから0が出ることはある。
 *
 * ただし**0を出してよいのは、数えた結果が0だったときだけ**である。
 * 読み込み中や取得失敗まで0で描くと、承認待ちが8件あるのに
 * 「今月の成果0件」と読めてしまい、運用者は成果が無いと誤解する。
 * 状態は分けて持ち、取れていないものは `—` にする。
 */

/** 集計の状態。**実値0と、まだ取れていないものを混ぜない。** */
export type ConfirmedState = 'loading' | 'ready' | 'error'

/**
 * JSTの年月（`YYYY-MM`）。
 *
 * Workerが書く `created_at` は `+09:00` 付きのJSTなので、月の境目は
 * JSTで判定しなければならない。`new Date().toISOString()` はUTCなので、
 * **JSTで月が変わってから9時間のあいだ、今月の成果を前月扱いにして
 * 全部落としてしまう。**
 */
export function jstMonthKey(at: string | number = Date.now()): string {
  const ms = typeof at === 'number' ? at : new Date(at).getTime()
  if (!Number.isFinite(ms)) return ''
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 7)
}

/** 今月に発生し、承認まで済んだ成果だけを残す。 */
export function confirmedThisMonth(
  items: readonly ConversionApprovalItem[],
  now: string | number = Date.now(),
): ConversionApprovalItem[] {
  const month = jstMonthKey(now)
  if (!month) return []
  return items.filter(
    (item) => item.approvalStatus === 'approved' && jstMonthKey(item.createdAt) === month,
  )
}

/** 帯に出す3つの数。 */
export function confirmedTotals(items: readonly ConversionApprovalItem[]): {
  count: number
  yen: number
  miles: number
} {
  return {
    count: items.length,
    yen: items.reduce((sum, item) => sum + (item.value ?? 0), 0),
    miles: items.reduce((sum, item) => sum + (item.offerRewardMiles ?? 0), 0),
  }
}

/** 取れていれば数、取れていなければ `null`（カードが `—` を出す）。 */
export function confirmedValue(state: ConfirmedState, total: number): number | null {
  return state === 'ready' ? total : null
}

/** `—` に単位を付けない。「—件」は数に見える。 */
export function confirmedUnit(state: ConfirmedState, unit: string): string {
  return state === 'ready' ? unit : ''
}

/** 数が出ないときは、代わりに理由を注記へ出す。 */
export function confirmedDetail(state: ConfirmedState, detail: string): string {
  if (state === 'loading') return STATE_TEXT.loading
  if (state === 'error') return STATE_TEXT.error
  return detail
}
