import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const CALENDAR = readFileSync(new URL('./booking-calendar.tsx', import.meta.url), 'utf8')
const CREATE = readFileSync(new URL('./new/page.tsx', import.meta.url), 'utf8')

describe('V6 予約管理の時間台帳', () => {
  test('今日・今週・今月・一覧を実際に切り替えられる', () => {
    expect(PAGE).toContain("useState<'day' | 'week' | 'month' | 'list'>('day')")
    for (const label of ['今日', '今週', '今月', '一覧']) expect(PAGE).toContain(label)
    expect(PAGE).toContain('onClick={() => setView(key)}')
  })

  test('今日を時間×担当、今週を時間×曜日の格子で表示する', () => {
    expect(CALENDAR).toContain('function DayGrid')
    expect(CALENDAR).toContain('function WeekGrid')
    expect(CALENDAR).toContain('repeat(${Math.max(staff.length, 1)}, minmax(0, 1fr))')
    expect(CALENDAR).toContain("'64px repeat(7, minmax(0, 1fr))'")
    // ★V7：色の見方は帯ではなく小さな凡例（● LINEからの予約 ● 電話の予約）。
    expect(CALENDAR).toContain('●</span> LINEからの予約')
    expect(CALENDAR).toContain('●</span> 電話の予約')
  })

  test('格子ごとに走査せず辞書へ束ねる(点検#516の中1)', () => {
    expect(CALENDAR).toContain('new Map<string, BookingRequest[]>()')
    expect(CALENDAR).not.toContain('items.filter((booking) => booking.staff_name === name')
    expect(CALENDAR).not.toContain('items.filter((booking) => jstDay(booking.starts_at) === day')
  })

  test('電話予約はLINE予約と同じ格子へ出し、未連携の理由も隠さない', () => {
    expect(CALENDAR).toContain('function isPhoneBooking')
    expect(CALENDAR).toContain("!booking.friend_id")
    expect(CALENDAR).toContain('電話予約のお客さま')
    expect(CALENDAR).toContain('LINE未連携の方には当日の連絡ができません。')
  })

  test('代理予約入力は設計の案内・プレビュー・連携先を持つ', () => {
    for (const text of [
      'LINEの友だちなら、名前で探して結びつけてください。',
      'お客様に何を送りますか',
      'この方について',
      'つながる先',
    ]) expect(CREATE).toContain(text)
    // B-6: 題「LINEプレビュー」は共通部品が出す。画面側は使うだけ。
    expect(CREATE).toContain('<LinePreview')
    expect(CREATE).toContain('予約と顧客台帳に残ります')
  })

  test('予約詳細は予約・履歴・顧客・当日の注意を一画面で確認できる', () => {
    expect(PAGE).toContain('data-design-node="TnDbq"')
    for (const text of [
      '予約の中身',
      'この方のこれまで',
      'この予約で動いたこと',
      'お客様とペット',
      '当日 気をつけること',
      '時間や担当を変える',
    ]) expect(PAGE).toContain(text)
    expect(PAGE).toContain('bookingApi.getBooking')
    expect(PAGE).toContain('detail?.previousHandover')
    expect(PAGE).toContain('lineOperation.status')
  })

  test('空きセルが代理予約の入口になる (#933 N-399)', () => {
    // 日・週どちらの格子でも、空きセルから代理予約画面へ日時（と担当）を渡す。
    expect(CALENDAR).toContain('function newBookingHref')
    expect(CALENDAR).toContain('`/booking/bookings/new?${params.toString()}`')
    expect(CALENDAR).toContain("date: input.day")
    expect(CALENDAR).toContain("params.set('staff', input.staffName)")
    expect(CALENDAR).toContain('aria-label="この空き枠に予約を入れる"')
    // 操作できない人（canCreate=false）は「あき」の文字だけ。押せる形に見せない。
    expect(CALENDAR).toContain('if (!href) {')
    expect(CALENDAR).toContain('canCreate && slot ? newBookingHref({ day, time: slot.start, staffName: name, menuId: slot.menuId }) : undefined')
    expect(CALENDAR).toContain('canCreate && slot ? newBookingHref({ day, time: slot.start, staffName: slot.staffName, menuId: slot.menuId }) : undefined')
  })

  test('BOOKING-01: 空きはマス数ではなく空き枠APIの実績から計算する', () => {
    // 「7日×10マス−予約件数」のような架空の枠数を出さない。
    expect(CALENDAR).not.toContain('7 * HOURS.length')
    expect(CALENDAR).not.toContain('staff.length * HOURS.length')
    // 実績はサーバーの空き枠APIから取る（営業時間・シフト・例外日・
    // 外部予定・同時受付数を考慮済みの枠）。
    expect(PAGE).toContain('bookingApi.getAvailability')
    expect(PAGE).toContain('menuId: menu.id')
    // 未設定・取得不能・空き0を区別する。未設定/取得不能/受付0は「—」。
    expect(PAGE).toContain("status: 'unconfigured'")
    expect(PAGE).toContain("status: 'error'")
    expect(CALENDAR).toContain("availability.status === 'unconfigured'")
    expect(CALENDAR).toContain("availability.status === 'error'")
    expect(CALENDAR).toContain('担当者か予約メニューが未設定です')
    expect(CALENDAR).toContain('受付可能な時間がありません')
  })

  test('BOOKING-01: 稼働率は塞がった時間÷受付可能時間。受付0は「—」', () => {
    // 要件: 予約で塞がった時間 ÷ 受付可能時間。取消・拒否は塞がない。
    expect(CALENDAR).toContain("OCCUPIED_STATUSES = new Set(['requested', 'confirmed', 'completed', 'no_show'])")
    expect(CALENDAR).toContain('capacity.bookedMs / capacity.acceptableMs')
    expect(CALENDAR).toContain('受付')
  })

  test('BOOKING-01: 実際に取れる枠だけが代理予約の入口になる', () => {
    // remaining>0 の枠があるマスだけ入口にし、取れないマスは「—」。
    expect(CALENDAR).toContain('slot.remaining <= 0')
    // ★V7：受け付けていないマスは空のまま、読み上げだけ伝える。
    expect(CALENDAR).toContain('<span className="sr-only">受け付けていない時間</span>')
    // 入口は枠を出したメニューと実際の開始時刻・担当を事前入力し、
    // メニュー候補のない入口へ遷移させない。
    expect(CALENDAR).toContain("params.set('menu', input.menuId)")
    expect(CALENDAR).toContain('time: slot.start')
  })

  test('URLの日付・時刻・担当は下書きより優先して事前入力する (#933 N-399)', () => {
    expect(CREATE).toContain("params.get('date')")
    expect(CREATE).toContain("params.get('time')")
    expect(CREATE).toContain("params.get('staff')")
    // 担当名はメニュー選択後の担当一覧と display_name で照合してから選ぶ
    expect(CREATE).toContain('pending.staffName')
    expect(CREATE).toContain('item.display_name === pending.staffName')
  })

  test('確認・完了・競合はV6の左右構造と次の操作を持つ', () => {
    for (const text of [
      'お客様に送るもの',
      '送る前に、文面をそのまま確かめられます。',
      '入れた予約',
      'このあと自動で動くもの',
      '続けてもう1件入れる',
      '空いている時間',
      'ほかの担当なら入れられます',
    ]) expect(CREATE).toContain(text)
    expect(CREATE).toContain('slot.date === date && slot.start !== time')
  })
})
