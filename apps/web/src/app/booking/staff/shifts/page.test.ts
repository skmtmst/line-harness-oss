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

  it('店舗設定と実際の空き状況を読み、未契約の値だけを作らない', () => {
    expect(PAGE).toContain('bookingApi.getSettings(selectedAccountId)')
    expect(PAGE).toContain('settings.businessHours.find')
    expect(PAGE).toContain('settings.maxActiveBookingsPerFriend')
    expect(PAGE).toContain('bookingApi.getAvailability(selectedAccountId')
    expect(PAGE).not.toContain('staffId: staff.id')
    expect(PAGE).toContain('残数が現在の空き情報に含まれないため')
    expect(PAGE).toContain('店舗・設備単位の1時間受付上限は現在の設定APIに含まれません')
    expect(PAGE).not.toContain('準備中')
  })

  it('画面確認APIが通常状態を本番と同じ器で返す', () => {
    for (const name of ['BOOKING_SETTINGS', 'BOOKING_AVAILABILITY']) {
      expect(FIXTURES).toContain(`export const ${name}`)
      expect(MOCK).toContain(name)
    }
    expect(MOCK).toContain("'/api/booking/admin/availability'")
    expect(MOCK).toContain("'/api/booking/admin/settings'")
  })

  it('休業日は実APIへ保存し、画面にも追加する', () => {
    expect(PAGE).toContain('bookingApi.createException(selectedAccountId')
    expect(PAGE).toContain("scopeKind: 'store'")
    expect(PAGE).toContain("kind: 'closed'")
    expect(PAGE).toContain('exceptions: [...current.exceptions, response.data]')
  })
})
