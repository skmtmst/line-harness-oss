import { couponPresentationError, defaultCouponInstructions, hasCouponPresentation } from '@line-crm/shared'

export type CouponDraft = {
  couponType: 'discount' | 'none'
  mode: 'amount' | 'percent' | 'price' | 'none'
  amount: string; percent: string; before: string; after: string
  conditions: string; showCode: boolean; code: string; instructions: string
}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const number = (value: unknown) => typeof value === 'number' ? String(value) : ''
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function initialCouponDraft(payload?: Record<string, unknown>, visual = false): CouponDraft {
  const discount = object(payload?.discount), code = object(payload?.code)
  return {
    couponType: payload ? payload.couponType === 'discount' ? 'discount' : 'none' : 'discount',
    mode: payload ? ['amount', 'percent', 'price'].includes(String(discount.mode)) ? discount.mode as CouponDraft['mode'] : 'none' : visual ? 'percent' : 'amount',
    amount: number(discount.amountYen), percent: payload ? number(discount.percent) : visual ? '20' : '',
    before: number(discount.beforeYen), after: number(discount.afterYen),
    conditions: text(payload?.conditions), showCode: Boolean(text(code.text)), code: text(code.text),
    instructions: payload ? text(payload.instructions) || text(payload.description) : defaultCouponInstructions(),
  }
}

/** Untouched legacy records do not acquire new fields or a replacement guide. */
export function couponDraftPayload(draft: CouponDraft, original?: Record<string, unknown>): Record<string, unknown> {
  if (original && JSON.stringify(draft) === JSON.stringify(initialCouponDraft(original))) {
    return Object.fromEntries(['couponType', 'discount', 'conditions', 'code', 'instructions'].filter(key => key in original).map(key => [key, original[key]]))
  }
  const discount = draft.couponType === 'none' || draft.mode === 'none' ? { mode: 'none' }
    : draft.mode === 'amount' ? { mode: 'amount', amountYen: draft.amount.trim() ? Number(draft.amount) : NaN }
    : draft.mode === 'percent' ? { mode: 'percent', percent: draft.percent.trim() ? Number(draft.percent) : NaN }
    : { mode: 'price', beforeYen: draft.before.trim() ? Number(draft.before) : NaN, afterYen: draft.after.trim() ? Number(draft.after) : NaN }
  return { couponType: draft.couponType, discount, conditions: draft.conditions.trim(), code: draft.showCode ? { text: draft.code.trim() } : null, instructions: draft.instructions.trim() }
}

export function couponDraftProblems(draft: CouponDraft, original?: Record<string, unknown>) {
  const payload = couponDraftPayload(draft, original)
  // The existing validator owns numeric ranges and field lengths; the editor only assigns errors to fields.
  return {
    benefit: couponPresentationError({ couponType: payload.couponType, discount: payload.discount }),
    conditions: couponPresentationError({ conditions: payload.conditions }),
    code: couponPresentationError({ code: payload.code }),
    instructions: !draft.instructions.trim() ? '利用ガイドを入力してください'
      : couponPresentationError({ couponType: hasCouponPresentation(payload) ? 'none' : undefined, instructions: payload.instructions }),
  }
}
