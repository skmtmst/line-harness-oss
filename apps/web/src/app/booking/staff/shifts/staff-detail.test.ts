import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DETAIL = readFileSync(join(__dirname, 'staff-detail.tsx'), 'utf8')
const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')
const ROOT = join(__dirname, '..', '..', '..', '..', '..', '..', '..')
const MOCK = readFileSync(join(ROOT, 'scripts/visual-qa/mock-api.mjs'), 'utf8')
const FIXTURES = readFileSync(join(ROOT, 'scripts/visual-qa/fixtures.mjs'), 'utf8')

describe('担当者別 勤務・シフト・外の予定(N-405)', () => {
  it('?staff_id= のときだけ担当者ビューを開き、ないときは従来の受付枠のまま', () => {
    expect(PAGE).toContain("useSearchParams().get('staff_id')")
    expect(PAGE).toContain('<StaffDetail staffId={staffId} />')
    expect(PAGE).toContain('<StoreShiftsView />')
    expect(DETAIL).toContain('data-design-node="tksPcStaff"')
    expect(DETAIL).not.toContain('<Header')
    // 新節に data-design は付けない(設計に無い節を設計対応と偽らない。構造検査の対象外)。
    expect(DETAIL).not.toContain('data-design="Staff')
    for (const heading of ['いつもの勤務時間', '休憩', '日ごとのシフト', '外の予定', 'の予約枠（14日分）', 'つながる先']) {
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
      'bookingApi.deleteShift(selectedAccountId, staffId, removeTarget.id)',
      'bookingApi.generateShifts(selectedAccountId, staffId, {',
      'bookingApi.putGoogleCalendar(selectedAccountId, staffId, trimmed)',
      'bookingApi.deleteGoogleCalendar(selectedAccountId, staffId)',
    ]) {
      expect(DETAIL).toContain(call)
    }
  })

  it('休憩は曜日ごとに複数持てて、保存前は枠に反映されないと明示する', () => {
    expect(DETAIL).toContain('bookingApi.getBreaks(selectedAccountId, staffId)')
    expect(DETAIL).toContain('bookingApi.putBreaks(')
    expect(DETAIL).toContain('setBreakError(staffErrorMessage(error,')
    expect(DETAIL).toContain('保存はできますが、まだ予約枠には反映されません')
    expect(DETAIL).not.toContain('availability.ts')
  })

  /*
    曜日指定と日付指定の休憩は「同じ理由で同じく予約枠へ反映されない」。
    片方にだけ注記があると、運用者は注記の無いほうを「反映される」と読む。
    見出しの直後の説明文だけを切り出して見るので、別の節に同じ文が
    あっても通らない。文言は2つの節で一字一句そろえる。
  */
  const noteUnderHeading = (heading: string): string => {
    const at = DETAIL.indexOf(heading)
    expect(at, `見出し「${heading}」が無い`).toBeGreaterThan(-1)
    const open = DETAIL.indexOf('<p', at)
    const close = DETAIL.indexOf('</p>', open)
    expect(open, `「${heading}」の直後に説明文が無い`).toBeGreaterThan(-1)
    expect(close).toBeGreaterThan(open)
    return DETAIL.slice(DETAIL.indexOf('>', open) + 1, close)
  }

  it('休憩は曜日指定も日付指定も、枠へ反映されないことを同じ文言で断る', () => {
    const NOT_REFLECTED = '保存はできますが、まだ予約枠には反映されません。'
    const weekly = noteUnderHeading('>休憩</h2>')
    const byDate = noteUnderHeading('>この日だけの休憩</h3>')
    expect(weekly).toContain(NOT_REFLECTED)
    expect(byDate).toContain(NOT_REFLECTED)
    // 「別の話かもしれない」と読まれないよう、言い換えを許さない。
    expect(weekly.slice(weekly.indexOf('保存はできますが')))
      .toBe(byDate.slice(byDate.indexOf('保存はできますが')))
  })

  it('休憩は版付きで保存し、重なったら最新へ描き直す', () => {
    expect(DETAIL).toContain('breaksVersion,')
    expect(DETAIL).toContain('breakDatesVersion,')
    expect(DETAIL).toContain('error.status === 409')
    expect(DETAIL).toContain('ほかの変更と重なりました')
    expect(DETAIL).toContain('asBreakConflict(error.data)')
  })

  it('この日だけの休憩は日付ごとに持てる', () => {
    expect(DETAIL).toContain('bookingApi.getBreakDates(selectedAccountId, staffId)')
    expect(DETAIL).toContain('bookingApi.putBreakDates(')
    expect(DETAIL).toContain('この日だけの休憩')
    expect(DETAIL).toContain('setDateError(staffErrorMessage(error,')
  })

  it('保存が効いたあとは保存した口と予約枠を読み直す(2回目の保存が残る)', () => {
    const refreshes = DETAIL.match(/await refreshAfterSave\(\)/g) ?? []
    expect(refreshes.length).toBeGreaterThanOrEqual(4)
    expect(DETAIL).toContain('bookingApi.getAvailabilityRules(selectedAccountId, staffId)')
    expect(DETAIL).toContain('bookingApi.getAvailability(')
    expect(DETAIL).toContain('staffId,')
  })

  it('権限なし・見つからない・失敗をはっきり出し、保存失敗で入力を消さない', () => {
    expect(DETAIL).toContain('error.status === 403')
    expect(DETAIL).toContain('担当者の設定を${action}する権限がありません')
    expect(DETAIL).toContain('error.status === 404')
    expect(DETAIL).toContain('担当者が見つかりませんでした')
    expect(DETAIL).toContain('保存済みの内容は消えていません')
    expect(DETAIL).toContain('入力はそのまま残しています')
    expect(DETAIL).toContain('setRuleError(staffErrorMessage(error,')
    expect(DETAIL).toContain('setShiftError(staffErrorMessage(error,')
    expect(DETAIL).not.toContain('setError(e instanceof Error ? e.message : String(e))')
  })

  it('日付・時刻は文字列のまま送り、曜日と今日だけUTC計算する(DST安全)', () => {
    expect(DETAIL).toContain('work_date: newDate')
    expect(DETAIL).toContain('T00:00:00Z')
    expect(DETAIL).toContain("timeZone,")
    expect(DETAIL).not.toContain('getTimezoneOffset')
    expect(DETAIL).not.toContain('toLocaleString')
    expect(DETAIL).not.toContain('new Date(shift.work_date)')
  })

  it('日別シフトがある日は優先、ない日はいつもの時間、外の予定は枠を閉じる', () => {
    expect(DETAIL).toContain('ある日は、いつもの勤務時間よりこちらが優先されます')
    expect(DETAIL).toContain('外の予定は枠を閉じます')
    expect(DETAIL).toContain('すでにある日は残します')
  })

  it('撮影用の固定データと口が本番と同じ器でそろう', () => {
    for (const name of ['BOOKING_AVAILABILITY_RULES', 'BOOKING_BREAKS', 'BOOKING_BREAK_DATES', 'BOOKING_STAFF_SHIFTS', 'BOOKING_GOOGLE_CALENDAR']) {
      expect(FIXTURES).toContain(`export const ${name}`)
    }
    for (const path of ['staff\\/[^/]+\\/shifts', 'staff\\/[^/]+\\/availability-rules', 'staff\\/[^/]+\\/breaks', 'staff\\/[^/]+\\/break-dates', 'staff\\/[^/]+\\/google-calendar']) {
      expect(MOCK).toContain(path)
    }
  })

  it('キーボードで操作でき、日付と時刻は専用の入力を使う', () => {
    expect(DETAIL).toContain('type="date"')
    expect(DETAIL).toContain('type="time"')
    expect(DETAIL).toContain('aria-label=')
  })
})
