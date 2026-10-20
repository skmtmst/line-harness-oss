import { emptyValue } from '@/components/shared/empty-value';
import { formatNumber } from '@/lib/format';
import type { HqTemplate } from '@/lib/hq-templates-api';



/** M月D日（店の一覧と同じ。時刻は title）。 */

/**
 * 公開の札（店と同じ3つ：公開中／未公開の変更／下書きだけ。絵 ）。統括では「配ったか」で決める：
 * 配った先がいまの版を持っている＝公開中、直したあと配っていない先がある（API-18 の outdated_account_count）＝未公開の変更、まだ配っていない＝下書きだけ。
 */
export function stateOf(row: HqTemplate): { label: string; tone: 'live' | 'changes' | 'draft' } {
  if ((row.distributed_account_count ?? 0) === 0) return { label: '下書きだけ', tone: 'draft' }
  if ((row.outdated_account_count ?? 0) > 0) return { label: '未公開の変更', tone: 'changes' }
  return { label: '公開中', tone: 'live' }
}


/** 合計（API-18）。1つでも数えていない行があれば null（「—」）。 */
export function sumOrNull(values: Array<number | null | undefined>): number | null {
  if (values.some((value) => value == null)) return null
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}


/** 今月送った数（API-18）。取れない種類（別資産のクーポン等）は null＝「—」。0 は「0通」。 */
export function sentLabel(count: number | null | undefined): string {
  return count == null ? emptyValue('unknown') : `${formatNumber(count)}通`
}
