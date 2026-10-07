/* app/mileage/rewards/edit/reward-form.ts から写した（src/v8 は @/app を import できない）。古い側を直したら、ここも同じ判断を入れる。 */
import type { MileageRewardFailurePolicy, MileageRewardKind } from '@/lib/api'
import type { SegmentCondition } from '@/lib/segment-condition'

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
  targetConditions: SegmentCondition | null
  failurePolicy: MileageRewardFailurePolicy
  customerMessage: string
}

/** 全角の数字は半角へそろえてから読む（１０ → 10）。 */
export function normalizeDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xff10 + 0x30))
}

/**
 * R298: 空欄だけを `null`（限りなし・決めない）にする。
 * 数にならない入力は `undefined`——「無制限」へ黙って潰すと、
 * 上限を入れたつもりの使い道が実は無制限になるため、ここで区別する。
 */
export function optionalInteger(value: string): number | null | undefined {
  const normalized = normalizeDigits(value.trim())
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isInteger(parsed) ? parsed : undefined
}

/** 数の限り系の欄ごとの断り文。`Field` の error 表示にそのまま使う。 */
export const LIMIT_FIELD_ERRORS = {
  stockLimit: '数の限りは0以上の整数で入力してください',
  perFriendLimit: '1人あたりの上限は1以上の整数で入力してください',
  benefitExpiresDays: '交換後に使える日数は1以上の整数で入力してください',
} as const

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
  /*
   * R298/R299: 在庫は 0（品切れ）を許し、それ以外の上限・日数は 1 以上。
   * Worker の保存検証と同じ境界にする。
   */
  const stock = optionalInteger(form.stockLimit)
  if (stock === undefined || (stock !== null && stock < 0)) errors.push(LIMIT_FIELD_ERRORS.stockLimit)
  const perFriend = optionalInteger(form.perFriendLimit)
  if (perFriend === undefined || (perFriend !== null && perFriend < 1)) errors.push(LIMIT_FIELD_ERRORS.perFriendLimit)
  const benefit = optionalInteger(form.benefitExpiresDays)
  if (benefit === undefined || (benefit !== null && benefit < 1)) errors.push(LIMIT_FIELD_ERRORS.benefitExpiresDays)
  if (form.startsAt && form.endsAt && form.startsAt >= form.endsAt) {
    errors.push('交換終了は交換開始より後にしてください')
  }
  return errors
}
