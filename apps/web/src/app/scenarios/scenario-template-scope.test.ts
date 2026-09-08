import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCENARIOS = dirname(fileURLToPath(import.meta.url))
const FIRST_STEP = readFileSync(join(SCENARIOS, 'first-step', 'page.tsx'), 'utf8')
const DETAIL = readFileSync(join(SCENARIOS, 'detail', 'scenario-detail-client.tsx'), 'utf8')
const CAROUSEL = readFileSync(
  join(SCENARIOS, '..', '..', 'components', 'scenarios', 'carousel-picker.tsx'),
  'utf8',
)

/**
 * シナリオ側のテンプレート候補(再審査2・3)。
 * 初回一覧も含め、シナリオのアカウントで絞り、未公開・他アカウントを候補にしない。
 */
describe('シナリオのテンプレート候補は持ち主の公開版だけ', () => {
  it('first-step: シナリオのアカウントで一覧を取り、送れるものだけ残す', () => {
    expect(FIRST_STEP).toContain('scenarioReferenceData.templates(res.data.lineAccountId)')
    expect(FIRST_STEP).toContain('filterSendableTemplates(tpl.data, res.data.lineAccountId)')
    expect(FIRST_STEP).not.toContain('scenarioReferenceData.templates()')
  })

  it('detail: 候補一覧を公開版だけに絞る', () => {
    expect(DETAIL).toContain('filterSendableTemplates(tplRes.data, scenario?.lineAccountId)')
  })

  it('carousel-picker: アカウントを受け取り、持ち主の公開版だけを候補にする', () => {
    expect(CAROUSEL).toContain('accountId?: string | null')
    expect(CAROUSEL).toContain('scenarioReferenceData.templates(accountId ?? undefined)')
    expect(CAROUSEL).toContain('filterSendableTemplates(res.data, accountId)')
  })

  it('carousel-picker: 古い応答は世代で捨てる', () => {
    expect(CAROUSEL).toContain('createLoadGeneration()')
    expect(CAROUSEL).toContain('.isCurrent(generation)')
  })
})
