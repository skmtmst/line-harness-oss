import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TERMS_DOCUMENT } from '@/content/terms/musubo-terms'
import { canSubmitTerms, hasReadTerms, initialWizardStep, STEP } from './terms-state'

const consentSource = readFileSync(new URL('./terms-consent.tsx', import.meta.url), 'utf8')
const wizardSource = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const legalSource = readFileSync(
  new URL('../../../../../../../docs/legal/musubo-terms-v0.1-draft.md', import.meta.url),
  'utf8',
)

describe('利用規約への同意ステップ', () => {
  it('スクロールが不要な高さでは初期表示で読了扱いになる', () => {
    expect(hasReadTerms({ scrollTop: 0, clientHeight: 420, scrollHeight: 420 })).toBe(true)
    expect(consentSource).toContain('evaluate()')
    expect(consentSource).toContain('new ResizeObserver(evaluate)')
  })

  it('最下部へ届くまではチェックできず、8px以内まで読めば読了になる', () => {
    expect(hasReadTerms({ scrollTop: 300, clientHeight: 400, scrollHeight: 900 })).toBe(false)
    expect(hasReadTerms({ scrollTop: 493, clientHeight: 400, scrollHeight: 900 })).toBe(true)
    expect(consentSource).toContain('disabled={!readToEnd || saving}')
    expect(consentSource).toContain('tabIndex={0}')
    expect(consentSource).toContain('role="region"')
    expect(consentSource).toContain('aria-label="利用規約"')
  })

  it('読了後もチェックするまでは同意ボタンを有効にしない', () => {
    expect(canSubmitTerms(true, false)).toBe(false)
    expect(canSubmitTerms(true, true)).toBe(true)
    expect(consentSource).toContain('利用規約を最後までお読みください。')
    expect(consentSource).toContain('同意する場合は、上のチェックボックスにチェックを入れてください。')
  })

  it('現行版への同意だけSTEP2から開始し、旧版・未同意・取得失敗はSTEP1にする', () => {
    expect(initialWizardStep(TERMS_DOCUMENT.version)).toBe(STEP.BASICS)
    expect(initialWizardStep('v0.0-draft')).toBe(STEP.TERMS)
    expect(initialWizardStep(null)).toBe(STEP.TERMS)
    expect(wizardSource).toContain('.catch(() => {')
    expect(wizardSource).toContain('setStep(STEP.TERMS)')
    expect(wizardSource).toContain('✓ 完了')
  })

  it('画面用データが原典の全26節を保持し、社内向け法務メモだけを表示しない', () => {
    expect(TERMS_DOCUMENT.sections).toHaveLength(26)
    for (const section of TERMS_DOCUMENT.sections) {
      expect(legalSource).toContain(section.heading)
      expect(legalSource).toContain(section.body)
    }
    expect(JSON.stringify(TERMS_DOCUMENT)).not.toContain('法務確認が必要な箇所')
    expect(legalSource).toContain('## 【法務確認が必要な箇所】')
  })
})
