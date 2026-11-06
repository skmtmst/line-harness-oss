import { describe, expect, it } from 'vitest'
import { couponDraftPayload, couponDraftProblems, initialCouponDraft } from './coupon-draft'
import { defaultCouponInstructions } from '@line-crm/shared'

describe('クーポン編集の保存値', () => {
  it('新規は種類の表示なしで、割引を選んだ場合だけ金額が必要', () => {
    const draft = initialCouponDraft()
    expect(draft.couponType).toBe('none')
    expect(couponDraftProblems(draft).benefit).toBeNull()
    expect(couponDraftPayload(draft)).toMatchObject({ couponType: 'none', discount: { mode: 'none' } })
    expect(couponDraftProblems({ ...draft, couponType: 'discount' }).benefit).toBeTruthy()
  })
  it('旧データを開いただけでは種類・割引・ガイドを補完しない', () => {
    const old = { description: 'あ'.repeat(600), title: 'あ'.repeat(61), maxUsesPerFriend: 3, useActions: [{ type: 'tag_add', tagId: 'tag-1' }], imageMediaId: 'media-1' }
    const original = JSON.stringify(old), draft = initialCouponDraft(old)
    expect(draft.instructions).toBe(old.description)
    expect(couponDraftPayload(draft, old)).toEqual({})
    expect(couponDraftProblems(draft, old)).toEqual({ benefit: null, conditions: null, code: null, instructions: null })
    expect(JSON.stringify(old)).toBe(original)
  })
  it('新規のガイドは3行、金額は未入力のまま公開できない', () => {
    const draft = { ...initialCouponDraft(), couponType: 'discount' as const }
    expect(draft.instructions).toBe(defaultCouponInstructions())
    expect(draft.instructions.split('\n')).toHaveLength(3)
    expect(couponDraftProblems(draft).benefit).toBeTruthy()
    expect(couponDraftProblems({ ...draft, amount: '500' }).benefit).toBeNull()
  })
  it.each([
    [{ mode: 'percent' as const, percent: '0' }, 'benefit'],
    [{ mode: 'price' as const, before: '100', after: '100' }, 'benefit'],
    [{ conditions: 'あ'.repeat(31) }, 'conditions'],
    [{ showCode: true, code: '\n' }, 'code'],
    [{ instructions: 'あ'.repeat(501) }, 'instructions'],
  ])('不正値は画面でも保存と同じ基準で拒む: %j', (patch, field) => {
    expect(couponDraftProblems({ ...initialCouponDraft(), couponType: 'discount', amount: '500', ...patch })[field as keyof ReturnType<typeof couponDraftProblems>]).toBeTruthy()
  })
  it('コード非表示はnullを送り、既存の任意情報は変更しない', () => {
    const old = { couponType: 'discount', discount: { mode: 'amount', amountYen: 500 }, instructions: '案内', code: { text: 'SALE' }, legacyNote: '保持' }
    const draft = { ...initialCouponDraft(old), showCode: false }
    expect({ ...old, ...couponDraftPayload(draft, old) }).toMatchObject({ legacyNote: '保持', discount: { mode: 'amount', amountYen: 500 }, code: null, instructions: '案内' })
  })
})
