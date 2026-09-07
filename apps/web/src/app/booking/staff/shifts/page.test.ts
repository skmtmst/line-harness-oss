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
    expect(PAGE).toContain('○・×は受付上限に対する残数を反映しています')
    expect(PAGE).not.toContain('△')
    expect(PAGE).toContain('bookingApi.listResources(selectedAccountId)')
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

  it('設備一覧は本番の包みで受け、旧い器の読み替えを残さない', () => {
    expect(MOCK).toContain("'/api/booking/admin/resources': { success: true, data: { resources: BOOKING_RESOURCES } }")
    expect(PAGE).toContain('resourcesResult.data.resources')
    expect(PAGE).not.toContain('as unknown as { resources')
  })

  it('休業日は実APIへ保存し、画面にも追加する', () => {
    expect(PAGE).toContain('bookingApi.createException(selectedAccountId')
    expect(PAGE).toContain("scopeKind: 'store'")
    expect(PAGE).toContain("kind: 'closed'")
    expect(PAGE).toContain('exceptions: [...current.exceptions, response.data]')
  })

  it('日時の表示は予約設定内の共通整形を使う', () => {
    expect(PAGE).toContain("from '../../lib/format-time'")
    expect(PAGE).not.toContain('function openHours(')
    expect(PAGE).not.toContain('function breakHours(')
    expect(PAGE).not.toContain('function shortDate(')
  })
})
