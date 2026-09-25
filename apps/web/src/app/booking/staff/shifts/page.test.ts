import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')
const PREVIEW = readFileSync(join(__dirname, 'liff-preview.tsx'), 'utf8')
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
    // Issue #643: 実LIFFは「日時を選んでください」＋日付の横並び札＋3列時刻ボタン（★V7）。
    // 架空の月間カレンダー（○×休・凡例・内訳）は実画面に無いので残さない。
    expect(PREVIEW).toContain('日時を選んでください')
    expect(PREVIEW).toContain('この期間に空きはありません。')
    expect(PREVIEW).toContain('grid-cols-3')
    expect(PREVIEW).not.toContain('grid-cols-4')
    // 失敗は実LIFFの LoadErrorView と同じ題＋本文（★V7）。
    expect(PREVIEW).toContain('読み込めませんでした')
    expect(PREVIEW).toContain('電波の良いところで、もう一度お試しください。')
    expect(PREVIEW).not.toContain('時間をおいて、もう一度お試しください。')
    expect(PAGE).not.toContain('ご希望の日をえらんでください')
    expect(PAGE).not.toContain('grid-cols-7')
    expect(PREVIEW).not.toContain('ご希望の日をえらんでください')
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

  it('営業時間は共通versionで週全体を保存し、未設定の0行曜日を定休日と誤表示しない', () => {
    expect(PAGE).toContain('businessHoursConfigured')
    expect(PAGE).toContain('bookingApi.saveSettings(accountId')
    expect(PAGE).toContain('expectedVersion: settings.version')
    expect(PAGE).toContain('businessHours: draft')
    expect(PAGE).toContain('未設定（現在は担当者の勤務時間どおり）')
    expect(PAGE).toContain('営業時間は日ごとに分けて入力してください')
    expect(PAGE).toContain('activeRef.current')
    expect(PAGE).toContain('同時受付数は「1時間に受けられる数」ではなく、同じ時間に重ねられる予約数です')
    expect(PAGE).not.toContain('件／時')
  })

  it('日時の表示は予約設定内の共通整形を使う', () => {
    expect(PAGE).toContain("from '../../lib/format-time'")
    expect(PAGE).not.toContain('function openHours(')
    expect(PAGE).not.toContain('function breakHours(')
    expect(PAGE).not.toContain('function shortDate(')
  })

  it('登録済みの休業日は版付きで修正・削除でき、削除は確認を挟む (#953 E-09)', () => {
    expect(PAGE).toContain('bookingApi.updateException(selectedAccountId')
    expect(PAGE).toContain('bookingApi.deleteException(selectedAccountId')
    expect(PAGE).toContain('expectedVersion: item.version')
    expect(PAGE).toContain('修正する')
    expect(PAGE).toContain('削除する')
    expect(PAGE).toContain('この休業日を消しますか？')
    // 閲覧のみの人には入口を出さない。
    expect(PAGE).toContain('canEditSettings')
  })
})
