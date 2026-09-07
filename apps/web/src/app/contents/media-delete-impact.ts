import type { MediaDeleteImpact, MediaDeleteImpactReference } from '@line-crm/shared'
import { mediaUsageKindText } from './media-usage-display'

/**
 * メディアを消したときの影響（設計 `YfTfJ` 15-1-C／契約 #610）。
 *
 * **消せるかどうかを画面が推測しない。** 使用先は7種類（テンプレート・
 * 一斉配信・リッチメニュー・シナリオ・コラム・イベント・ウェビナー）に
 * またがるので、画面が数えると必ずどれかを取りこぼす。
 * Workerが削除直前に読み切った結果（`checkedAt`）をそのまま出す。
 */

/** 取得元が無い値。実値の0とは別。 */
export const NOT_AVAILABLE = '—（未取得）'

/**
 * 使用先の種類。**内部の記号をそのまま出さない。**
 *
 * 言い方の表は `media-usage-display.ts` の1つだけにする。ここに2つ目の
 * 表を置くと、片方だけ直して「シナリオの通」のような食い違いが再発する。
 */
export function referenceKindText(kind: MediaDeleteImpactReference['kind']): string {
  return mediaUsageKindText(kind)
}

/**
 * 使用先の名前。
 *
 * `name` が `null` なのは**消えた**か**別のアカウントで見せられない**とき。
 * 空欄にすると「名前の無い使用先」に見えるので、どちらか分かる形で書く。
 */
export function referenceNameText(reference: MediaDeleteImpactReference): string {
  if (reference.name) return reference.name
  return reference.state === 'unavailable'
    ? '別のアカウントの使用先（名前は表示できません）'
    : NOT_AVAILABLE
}

/**
 * 題。
 *
 * **消せないときは「削除しますか？」と聞かない。** 聞いてから断るより、
 * 最初から消せないと言うほうが短い。
 */
export function dialogTitle(impact: MediaDeleteImpact | null, filename: string): string {
  if (!impact) return `「${filename}」を削除しますか？`
  return impact.canDelete ? `「${filename}」を削除しますか？` : `「${filename}」は削除できません`
}

/** 使用中の言い方。**0件は「どこでも使っていません」**で、未取得と混ぜない。 */
export function usageText(impact: MediaDeleteImpact): string {
  if (impact.usageCount === 0) return 'どこでも使っていません。'
  return `いま ${impact.usageCount.toLocaleString('ja-JP')}か所で使われています。`
}

/** 消せない理由。設計の「そこから外すか、別の画像に差し替えてください」。 */
export function blockedReason(impact: MediaDeleteImpact): string | null {
  if (impact.canDelete) return null
  return '使われているあいだは削除できません。使用先から外してから、もう一度お試しください。'
}

/** 確かめた時刻。**「いつ時点の話か」が無いと、消す判断ができない。** */
export function checkedAtText(checkedAt: string): string {
  const date = new Date(checkedAt)
  if (Number.isNaN(date.getTime())) return NOT_AVAILABLE
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo',
  }).format(date)
}

/**
 * 消してよいか。
 *
 * **`canDelete` と `usageCount` の両方を見る。** どちらか一方だけだと、
 * 片方が更新されたときに押せてしまう組み合わせが残る。
 */
export function canDelete(input: {
  impact: MediaDeleteImpact | null
  busy: boolean
}): boolean {
  if (!input.impact || input.busy) return false
  return input.impact.canDelete && input.impact.usageCount === 0
}

/**
 * まとめて削除の結果文。
 *
 * **成功数と失敗した名前を1つの文にまとめる。** 件ごとに上書きすると
 * 最後の1件しか残らず、消す操作なのに結果が曖昧になる。
 */
export function summarizeBulkDeleteResult(deletedCount: number, failedNames: string[]): {
  tone: 'success' | 'error'
  message: string
} {
  if (failedNames.length === 0) return { tone: 'success', message: `削除しました（${deletedCount}件）` }
  if (deletedCount === 0) return { tone: 'error', message: `削除できませんでした（${failedNames.join('、')}）` }
  return {
    tone: 'error',
    message: `削除しました${deletedCount}件、失敗${failedNames.length}件（${failedNames.join('、')}）`,
  }
}
