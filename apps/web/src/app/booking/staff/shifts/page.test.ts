import { join } from 'node:path'
import { describe,expect,it } from 'vitest'
import { readUiSource as readFileSync } from '../../../../../scripts/test-ui-source.mjs'

const PAGE = readFileSync(join(__dirname, '../../../../v8/booking-menus/settings.tsx'), 'utf8')
const PREVIEW = readFileSync(join(__dirname, '../../../../v8/booking-staff/phone.tsx'), 'utf8')
const ROOT = join(__dirname, '..', '..', '..', '..', '..', '..', '..')
const MOCK = readFileSync(join(ROOT, 'scripts/visual-qa/mock-api.mjs'), 'utf8')
const FIXTURES = readFileSync(join(ROOT, 'scripts/visual-qa/fixtures.mjs'), 'utf8')

describe('受付枠と休業日のV8の動作契約', () => {
  it('店舗設定と実際の空き状況を読み、未契約の値だけを作らない', () => {
    expect(PAGE).toContain('bookingApi.getSettings(accountId)')
    expect(PAGE).toContain('settings.businessHours.find')
    expect(PAGE).toContain('settings.maxActiveBookingsPerFriend')
    expect(PAGE).toMatch(/bookingApi\s*\.getAvailability\(accountId/)
    expect(PAGE).toContain('applyStoreRules: true')
    // Issue #643: 実LIFFは「日時を選んでください」＋週／カレンダー切替（★V8）。
    // 週は5日の並び＋3列時刻ボタン、カレンダーは月の表（プレビュー部品だけが持つ）。
    // 「空き枠の内訳」は実画面に無いので残さない。
    expect(PREVIEW).toContain('日時を選んでください')
    // ★V8（板 ）：空きなしは「この週は空きがありません」。
    expect(PREVIEW).toContain('この期間に空きはありません。')
    expect(PREVIEW).toContain('className={styles.slots}')
    expect(PREVIEW).not.toContain('grid-cols-4')
    // 失敗は実LIFFの LoadErrorView と同じ題＋本文（★管理画面）。
    expect(PREVIEW).toContain('読み込めませんでした')
    expect(PREVIEW).toContain('onClick={onRetry}')
    expect(PREVIEW).not.toContain('時間をおいて、もう一度お試しください。')
    expect(PAGE).not.toContain('ご希望の日をえらんでください')
    expect(PAGE).not.toContain('grid-cols-7')
    expect(PREVIEW).not.toContain('ご希望の日をえらんでください')
    expect(PAGE).toContain('mergeStaffSlots')
    expect(PAGE).toMatch(/bookingApi\s*\.listResources\(accountId\)/)
    expect(PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')).not.toContain('準備中')
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
    expect(PAGE).toContain('res.data.resources')
    expect(PAGE).not.toContain('as unknown as { resources')
  })

  it('休業日は実APIへ保存し、画面にも追加する', () => {
    expect(PAGE).toContain('bookingApi.createException(accountId')
    expect(PAGE).toContain("scopeKind: 'store'")
    expect(PAGE).toContain("kind: 'closed'")
    expect(PAGE).toContain('exceptions: [...settings.exceptions, response.data]')
  })

  it('営業時間は共通versionで週全体を保存し、未設定の0行曜日を定休日と誤表示しない', () => {
    expect(PAGE).toContain('businessHoursConfigured')
    expect(PAGE).toContain('bookingApi.saveSettings(accountId')
    expect(PAGE).toContain('expectedVersion: settings.version')
    expect(PAGE).toContain('businessHours: draft')
    expect(PAGE).toContain('未設定（現在は担当者の勤務時間どおり）')
    expect(PAGE).toContain('営業時間は日ごとに分けて入力してください')
    expect(PAGE).toContain('saveGenerationRef.current')
    expect(PAGE).toContain('「同時」は1時間に受けられる数ではなく、同じ時間に重ねられる予約の数です。')
    expect(PAGE).not.toContain('件／時')
  })

  it('日時の表示は予約設定内の共通整形を使う', () => {
    expect(PAGE).toContain("from '@/lib/format'")
    expect(PAGE).toContain("from '../lib/format-time'")
    expect(PAGE).toContain('export function breakHours(')
    expect(PAGE).toContain('polishFormatDate')
  })

  it('担当者の管理先は予約設定のスタッフへ進み、顧客統合へ行かない(R162)', () => {
    expect(PAGE).not.toContain('href="/users"')
    expect(PAGE).toContain("{ key: 'staff', label: '担当スタッフ'")
    expect(PAGE).toContain('href="/booking/staff"')
    expect(PAGE).toContain('href="/staff"')
  })

  it('登録済みの休業日は版付きで修正・削除でき、削除は確認を挟む (#953 E-09)', () => {
    expect(PAGE).toContain('bookingApi.updateException(accountId')
    expect(PAGE).toContain('bookingApi.deleteException(accountId')
    expect(PAGE).toContain('expectedVersion: editing.version')
    expect(PAGE).toContain('openEdit(item)')
    expect(PAGE).toContain('休業日を削除する')
    expect(PAGE).toContain('を削除しますか？')
    // 閲覧のみの人には入口を出さない。
    expect(PAGE).toContain('canEditSettings')
  })
})
