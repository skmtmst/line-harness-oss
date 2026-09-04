import type { MileageRewardFailurePolicy, MileageRewardKind } from '@/lib/api'

/**
 * 使い道の入力の中身（設計 `p9CcEB` 17-1-G）。
 *
 * **`page.tsx` から出した。** Next の画面ファイルは `default` 以外を
 * 外へ出せないので、試験から直に呼べる形にするためこちらへ置く。
 */
export type FormState = {
  name: string
  description: string
  rewardKind: MileageRewardKind
  requiredMiles: string
  /** 空文字は「限りなし」。**0（品切れ）とは別。** */
  stockLimit: string
  perFriendLimit: string
  startsAt: string
  endsAt: string
  benefitExpiresDays: string
  commonActionVersionId: string
  failurePolicy: MileageRewardFailurePolicy
  customerMessage: string
}

/**
 * 送る前の確かめ。**Worker の検査を置き換えない。**
 * 押してから断られるより、打っている最中に気づけるだけ。
 */
export function validateReward(form: FormState): string[] {
  const errors: string[] = []
  if (!form.name.trim()) errors.push('使い道の名前を入力してください')
  const miles = Number(form.requiredMiles)
  if (!form.requiredMiles.trim() || !Number.isInteger(miles) || miles <= 0) {
    errors.push('必要マイルは1以上の整数で入力してください')
  }
  /* **クーポン以外は渡すものが要る**（Worker の `action_required` と同じ）。 */
  if (form.rewardKind !== 'coupon' && !form.commonActionVersionId.trim()) {
    errors.push('交換後に渡すものを選んでください')
  }
  if (form.startsAt && form.endsAt && form.startsAt >= form.endsAt) {
    errors.push('交換終了は交換開始より後にしてください')
  }
  return errors
}
