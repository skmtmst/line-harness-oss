import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DETAIL = readFileSync(join(__dirname, '../../../../v8/booking-staff/shifts.tsx'), 'utf8')
const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')
const ROOT = join(__dirname, '..', '..', '..', '..', '..', '..', '..')
const MOCK = readFileSync(join(ROOT, 'scripts/visual-qa/mock-api.mjs'), 'utf8')
const FIXTURES = readFileSync(join(ROOT, 'scripts/visual-qa/fixtures.mjs'), 'utf8')

describe('担当者別 勤務・シフト・外の予定(N-405)', () => {
  it('?staff_id= は現役V8の担当勤務、管理者の指定なしは店舗の受付枠へ進む', () => {
    expect(PAGE).toContain("useSearchParams().get('staff_id')")
    expect(PAGE).toContain('<StaffShiftsV8 staffId={staffId} />')
    expect(DETAIL).toContain("router.replace('/booking/menus?tab=hours')")
    expect(DETAIL).toContain('<StaffShiftsDetail staffId={staffId}')
    expect(DETAIL).toContain('<PageHeading')
    for (const heading of ['いつもの勤務時間', '休憩', 'この日だけ', '何週分かのシフト', 'Google カレンダー', 'の予約枠（14日分）']) {
      expect(DETAIL).toContain(heading)
    }
    expect(DETAIL).not.toContain('準備中')
  })

  it('通常勤務・休憩・日別シフト・外の予定を読む(休憩は裁定Aの新口)', () => {
    for (const call of [
      'bookingApi.listStaff(selectedAccountId)',
      'bookingApi.getAvailabilityRules(selectedAccountId, staffId)',
      'bookingApi.getBreaks(selectedAccountId, staffId)',
      'bookingApi.getShifts(selectedAccountId, staffId)',
      'bookingApi.getGoogleCalendar(selectedAccountId, staffId)',
    ]) {
      expect(DETAIL).toContain(call)
    }
  })

  it('作成・変更・削除を既存の口で送る', () => {
    for (const call of [
      'bookingApi.putAvailabilityRules(selectedAccountId, staffId, payload)',
      'bookingApi.putBreaks(',
      'bookingApi.putShifts(selectedAccountId, staffId, [',
      'bookingApi.deleteShift(selectedAccountId, staffId, removeTarget.item.id)',
      'bookingApi.generateShifts(selectedAccountId, staffId, {',
      'bookingApi.putGoogleCalendar(selectedAccountId, staffId, trimmed)',
      'bookingApi.deleteGoogleCalendar(selectedAccountId, staffId)',
    ]) {
      expect(DETAIL).toContain(call)
    }
  })

  it('休憩は曜日ごとに複数持てて、枠から除くことを明示する(R164)', () => {
    // R164 で枠への反映を実装したため、未対応の断りは残さない。
    expect(DETAIL).toContain('bookingApi.getBreaks(selectedAccountId, staffId)')
    expect(DETAIL).toContain('bookingApi.putBreaks(')
    expect(DETAIL).toContain('setBreakError(staffErrorMessage(error,')
    expect(DETAIL).toContain('休憩の時間は予約枠から除きます')
    expect(DETAIL).not.toContain('まだ予約枠には反映されません')
    expect(DETAIL).not.toContain('availability.ts')
  })

  it('休憩は曜日指定も日付指定も、予約枠の読み直しへ反映する', () => {
    expect(DETAIL).toContain('休憩の時間は予約枠から除きます。')
    expect(DETAIL).toContain('bookingApi.putBreaks(')
    expect(DETAIL).toContain('bookingApi.putBreakDates(')
    expect(DETAIL).toContain('await loadAvailability(')
    expect(DETAIL).toContain("kind: 'break'")
  })

  it('休憩は版付きで保存し、409では入力を保持して本人が最新を読む', () => {
    expect(DETAIL).toContain('breaksVersion,')
    expect(DETAIL).toContain('breakDatesVersion,')
    expect(DETAIL).toContain('error.status === 409')
    expect(DETAIL).toContain('ほかの変更と重なりました')
    expect(DETAIL).toContain('breakSaveConflict.mark()')
    expect(DETAIL).toContain('dateSaveConflict.mark()')
    expect(DETAIL).toContain('入力はそのまま残しています')
    expect(DETAIL).toContain('breakSaveConflict.reloadLatest()')
    expect(DETAIL).toContain('dateSaveConflict.reloadLatest()')
    expect(DETAIL).not.toContain('asBreakConflict(error.data)')
  })

  it('この日だけの休憩は日付ごとに持てる', () => {
    expect(DETAIL).toContain('bookingApi.getBreakDates(selectedAccountId, staffId)')
    expect(DETAIL).toContain('bookingApi.putBreakDates(')
    expect(DETAIL).toContain('この日だけの休憩')
    expect(DETAIL).toContain('setShiftError(staffErrorMessage(error,')
  })

  it('保存が効いたあとは保存した口と予約枠を読み直す(2回目の保存が残る)', () => {
    const refreshes = DETAIL.match(/await refreshAfterSave\('(rules|days)'\)/g) ?? []
    expect(refreshes.length).toBeGreaterThanOrEqual(4)
    expect(DETAIL).toContain('bookingApi.getAvailabilityRules(selectedAccountId, staffId)')
    expect(DETAIL).toContain('bookingApi.getAvailability(')
    expect(DETAIL).toContain('staffId,')
  })

  it('権限なし・見つからない・失敗をはっきり出し、保存失敗で入力を消さない', () => {
    expect(DETAIL).toContain('error.status === 403')
    expect(DETAIL).toContain("permissionDeniedMessage('store')")
    expect(DETAIL).toContain('error.status === 404')
    expect(DETAIL).toContain('担当者が見つかりませんでした')
    expect(DETAIL).toContain('setRuleError(staffErrorMessage(error,')
    expect(DETAIL).toContain('入力はそのまま残しています')
    expect(DETAIL).toContain('setRuleError(staffErrorMessage(error,')
    expect(DETAIL).toContain('setShiftError(staffErrorMessage(error,')
    expect(DETAIL).not.toContain('setError(e instanceof Error ? e.message : String(e))')
  })

  it('日付・時刻は文字列のまま送り、曜日と今日だけUTC計算する(DST安全)', () => {
    expect(DETAIL).toContain('work_date: dayAddDate')
    expect(DETAIL).toContain('T00:00:00Z')
    expect(DETAIL).toContain("timeZone,")
    expect(DETAIL).not.toContain('getTimezoneOffset')
    expect(DETAIL).not.toContain('function toLocaleString() { [native code] }')
    expect(DETAIL).not.toContain('new Date(shift.work_date)')
  })

  it('14日の予約枠は店の今日を起点に日付順で持ち、曜日は各日のtitleで示す', () => {
    // 現役V8は曜日見出しの月曜始まりの表ではなく、日付と印の札を並べる。
    expect(DETAIL).toContain('const from = todayKey(timeZone)')
    expect(DETAIL).toContain('Array.from({ length: 14 }')
    expect(DETAIL).toContain('addDays(from, index)')
    expect(DETAIL).toContain('title={shortDay(item.date)}')
    expect(DETAIL).toContain('key={item.date}')
  })

  it('日別シフトがある日は優先、ない日はいつもの時間、外の予定は枠を閉じる', () => {
    expect(DETAIL).toContain('日ごとのシフトがある日はそちらが優先')
    expect(DETAIL).toContain('外の予定は枠を閉じます')
    expect(DETAIL).toContain('すでにある日は残す')
  })

  it('撮影用の固定データと口が本番と同じ器でそろう', () => {
    for (const name of ['BOOKING_AVAILABILITY_RULES', 'BOOKING_BREAKS', 'BOOKING_BREAK_DATES', 'BOOKING_STAFF_SHIFTS', 'BOOKING_GOOGLE_CALENDAR']) {
      expect(FIXTURES).toContain(`export const ${name}`)
    }
    for (const path of ['staff\\/[^/]+\\/shifts', 'staff\\/[^/]+\\/availability-rules', 'staff\\/[^/]+\\/breaks', 'staff\\/[^/]+\\/break-dates', 'staff\\/[^/]+\\/google-calendar']) {
      expect(MOCK).toContain(path)
    }
  })

  it('キーボードで操作でき、日付と時刻は現在の共通部品を使う', () => {
    expect(DETAIL).toContain('DateField')
    expect(DETAIL).toContain('TimeField')
    expect(DETAIL).toContain('date-field')
    expect(DETAIL).not.toContain('type="date"')
    expect(DETAIL).not.toContain('type="time"')
    expect(DETAIL).toContain('aria-label=')
  })
})
