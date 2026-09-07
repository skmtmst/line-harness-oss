import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')
const ROOT = join(__dirname, '..', '..', '..', '..', '..', '..', '..')
const MOCK = readFileSync(join(ROOT, 'scripts/visual-qa/mock-api.mjs'), 'utf8')
const FIXTURES = readFileSync(join(ROOT, 'scripts/visual-qa/fixtures.mjs'), 'utf8')

describe('受付枠と休業日のV6契約', () => {
  it('実Nodeと設計の主要な帯を持つ', () => {
    expect(PAGE).toContain('data-design-node="tksPc"')
    expect(PAGE).toContain("usePageTitle('予約設定')")
    expect(PAGE).not.toContain('<Header')
    for (const section of ['Tabs', 'Info', 'Week', 'Special', 'Rules', 'Preview', 'Trouble', 'Links']) {
      expect(PAGE).toContain(`data-design="${section}"`)
    }
  })

  it('受付上限と空き枠のAPI結果を表示する', () => {
    expect(PAGE).toContain('休けい時間を保存するAPIは未接続です')
    expect(PAGE).toContain('bookingApi.listResources')
    expect(PAGE).toContain('bookingApi.getAvailability')
    expect(PAGE).toContain('実際の空きと残数を表示します')
    expect(PAGE).not.toContain('準備中')
  })

  it('画面確認APIが通常状態を本番と同じ器で返す', () => {
    for (const name of ['BOOKING_AVAILABILITY_RULES', 'BOOKING_STAFF_SHIFTS', 'BOOKING_GOOGLE_CALENDAR']) {
      expect(FIXTURES).toContain(`export const ${name}`)
      expect(MOCK).toContain(name)
    }
    expect(MOCK).toContain("/availability-rules$/")
    expect(MOCK).toContain("/google-calendar$/")
  })
})
