import { describe, expect, it } from 'vitest'
import { TERMS_DOCUMENT } from '@/content/terms/musubo-terms'
import { canSubmitTerms, formatAgreedAt, hasReadTerms, initialWizardStep, STEP } from './terms-state'

describe('利用規約の同意の決まり（V8 の写し）', () => {
  it('いまの版に同意済みなら手順2から始める', () => {
    expect(initialWizardStep(TERMS_DOCUMENT.version)).toBe(STEP.BASICS)
    expect(initialWizardStep('v0.0-old')).toBe(STEP.TERMS)
    expect(initialWizardStep(null)).toBe(STEP.TERMS)
  })
  it('最後まで読んでチェックしたときだけ同意できる', () => {
    expect(hasReadTerms({ scrollTop: 0, clientHeight: 220, scrollHeight: 1000 })).toBe(false)
    expect(hasReadTerms({ scrollTop: 780, clientHeight: 220, scrollHeight: 1000 })).toBe(true)
    expect(hasReadTerms({ scrollTop: 0, clientHeight: 220, scrollHeight: 225 })).toBe(true)
    expect(canSubmitTerms(true, false)).toBe(false)
    expect(canSubmitTerms(true, true)).toBe(true)
  })
  it('同意した日時（D1 の UTC）を日本時間の「月/日 時:分」にする', () => {
    expect(formatAgreedAt('2026-10-02 14:41:00')).toBe('10/2 23:41')
    expect(formatAgreedAt('2026-10-02T14:41:00Z')).toBe('10/2 23:41')
    expect(formatAgreedAt(null)).toBeNull()
    expect(formatAgreedAt('こわれた値')).toBeNull()
  })
})
