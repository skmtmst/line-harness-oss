import { formatYen as yen } from '@line-crm/shared';
import type { BookingPassPlan } from '@line-crm/shared'
import { ApiError } from '@/lib/api'

/*
 * 回数券・月謝（B2）の言葉。docs/v8-requirements/gap-features/B2-tickets-monthly.md。
 * 種類の編集は管理者だけ。販売中の種類は変えられず、やめることだけできる。
 */
export const KIND_LABEL: Record<BookingPassPlan['kind'], string> = { ticket: '回数券', monthly: '月謝' }
export const STATUS_LABEL: Record<BookingPassPlan['status'], string> = { draft: '下書き', on_sale: '販売中', stopped: '止めた' }

/** 期限の選び肢（日）。API は 1〜3650 日。 */
export const VALID_CHOICES = [1, 3, 6].map(months => months * 30).concat(365)

export function validLabel(days: number): string {
  if (days % 365 === 0) return `${days / 365} 年`
  if (days % 30 === 0) return `${days / 30} か月`
  return `${days} 日`
}

export function countLabel(plan: Pick<BookingPassPlan, 'kind' | 'count' | 'monthlyLimit'>): string {
  if (plan.kind === 'ticket') return plan.count === null ? '—' : `${plan.count} 回`
  return plan.monthlyLimit === null ? '—' : `月 ${plan.monthlyLimit} 回`
}

export function periodLabel(plan: Pick<BookingPassPlan, 'kind' | 'validDays'>): string {
  return plan.kind === 'monthly' ? '毎月' : `買って ${validLabel(plan.validDays)}`
}

export { yen };

export function failureText(reason: unknown, doing: string): string {
  const code = reason instanceof ApiError ? reason.code : undefined
  if (code === 'version_conflict' || code === 'version_conflict_or_not_draft') return '別の人が先に変えていたか、販売を始めた種類は変えられません。読み直したので、もう一度お試しください。'
  if (code === 'invalid_pass_plan') return '入力を直してください。名前・値段・回数・期限を確かめます。'
  if (code === 'invalid_menu') return '選んだ予約が見つかりませんでした。選び直してください。'
  if (code === 'idempotency_conflict') return '同じ操作が別の内容で送られました。画面を読み直してください。'
  if (reason instanceof ApiError && reason.status === 403) return `${doing}権限がありません。オーナーか管理者に頼んでください。`
  return `${doing}ことができませんでした。時間をおいてもう一度お試しください。`
}

/** 作成画面から戻る商品一覧。旧ticketsへの入口はsettingsでpassesへ寄せる。 */
export const PASS_LIST_HREF = '/booking/menus?tab=passes'
