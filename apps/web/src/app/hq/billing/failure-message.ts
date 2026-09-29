import { ApiError } from '@/lib/api'
import { describeApiFailure, japaneseDetailOf } from '@/components/shared/api-error-message'

/**
 * M023/M024：課金の操作失敗の言い換え。
 *
 * Stripe への輸送失敗はサーバが 502 にして返す。画面では内部文
 * （`API error: 502`）を出さず、決済サービスの案内にする。
 * page.tsx と試験の両方から読む（page.tsx には default 以外を置けないため）。
 */
export const BILLING_UNREACHABLE = '決済サービスにつながりませんでした。少し待って、もう一度お試しください。'

export function billingFailureMessage(caught: unknown, action: string, forbidden: string): string {
  if (caught instanceof ApiError && caught.status === 502) return BILLING_UNREACHABLE
  return japaneseDetailOf(caught) || describeApiFailure(caught, action, { forbidden })
}
