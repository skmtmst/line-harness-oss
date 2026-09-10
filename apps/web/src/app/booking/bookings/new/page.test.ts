import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const LIST = readFileSync(new URL('../page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../../../lib/api.ts', import.meta.url), 'utf8')
const BOOKING_TYPES = readFileSync(
  new URL('../../../../../../worker/src/services/booking-types.ts', import.meta.url),
  'utf8',
)
const BOOKING_CONFIRM = readFileSync(
  new URL('../../../../../../worker/src/services/booking-confirm.ts', import.meta.url),
  'utf8',
)

describe('V6 代理予約の接続契約', () => {
  test('入力・確認・完了・競合の実Nodeを同じフローで持つ', () => {
    for (const node of ['cpdDi', 'GFDqW', 'GfceK', 'Lg8ff']) {
      expect(PAGE).toContain(node)
    }
    expect(PAGE).toContain('data-qa-open="GFDqW"')
    expect(PAGE).toContain('data-qa-open="GfceK"')
  })

  test('一覧の作成操作は準備中ではなく代理予約へ進む', () => {
    expect(LIST).toContain('href="/booking/bookings/new"')
    expect(LIST).toContain('電話の予約を入れる')
    expect(LIST).not.toContain('管理画面から予約を代理で入れる仕組みは準備中です')
  })

  test('確定APIはIdempotency-Keyを必ず送る', () => {
    expect(API).toContain("headers: { 'Idempotency-Key': idempotencyKey }")
    expect(PAGE).toContain('crypto.randomUUID()')
  })

  test('予約日時をWorkerへ渡し、実際に作る送信予定時刻を表示する', () => {
    expect(API).toContain('previewReminders:')
    expect(API).toContain('/api/booking/admin/reminder-preview?')
    expect(PAGE).toContain('bookingApi.previewReminders')
    expect(PAGE).toContain('reminder.scheduledAt')
    expect(PAGE).toContain('result.reminders.map')
    expect(PAGE).not.toContain('前日19:00')
    expect(PAGE).not.toContain('当日8:00')
    expect(BOOKING_TYPES).toContain('reminder_hours_before: 2')
    expect(BOOKING_CONFIRM).toContain('buildConfirmationReminderSchedule')
    expect(BOOKING_CONFIRM).toContain('item.scheduledAt')
  })

  test('確認へ進む直前に同じ空き枠APIを読み直し、埋まった枠を確定候補にしない', () => {
    expect(PAGE).toContain('const latest = await bookingApi.getAvailability')
    expect(PAGE).toContain("slot.date === date && slot.start === time")
    expect(PAGE).toContain('data-booking-slot-check="available"')
    expect(PAGE).toContain('この日時は、確認画面を開く直前に空きを再確認しました。')
    expect(PAGE).toContain('空き時間を再確認できませんでした。状態を読み直して、もう一度お試しください。')
  })

  test('アカウントや予約対象が変わったあとの古い返事を画面へ反映しない', () => {
    expect(PAGE).toContain("const selectionKey = [selectedAccountId ?? '', friend?.id ?? customer?.id ?? '', menuId, staffId, date, time]")
    expect(PAGE).toContain('latestSelectionKey.current = selectionKey')
    expect(PAGE).toContain('const requestKey = [selectedAccountId, friend?.id ?? selectedCustomer?.id ?? \'\', menuId, staffId, date, time]')
    expect(PAGE).toContain('if (latestSelectionKey.current !== requestKey) return')
    expect(PAGE).toContain('if (latestSelectionKey.current === requestKey) setLoading(false)')
    expect(PAGE).toContain("setIdempotencyKey('')")
  })

  test('完了画面は作り物の成果数ではなく、実際に追加した予約台帳の1件を説明する', () => {
    expect(PAGE).toContain('1件追加（電話で受けた予約も同じ台帳へ記録します）')
    expect(PAGE).not.toContain('成果地点「予約が入った」を1件')
  })

  test('予約枠の競合を表示文言ではなく安全な機械コードで判定して選び直せる', () => {
    expect(PAGE).toContain('ApiError,')
    expect(PAGE).toContain('cause instanceof ApiError')
    expect(PAGE).toContain("cause.code === 'slot_conflict' || cause.code === 'slot_not_available'")
    expect(PAGE).toContain("setStep('conflict')")
    expect(PAGE).toContain('cause.data as BookingConflictAlternatives')
    expect(PAGE).toContain('conflictAlternatives.conflict.count')
    expect(PAGE).toContain('conflictAlternatives.alternateStaff.map')
    expect(PAGE).toContain('選んだ時間は、ほかの予約で埋まりました')
    expect(PAGE).toContain('予約を登録できませんでした。状態を確認して、もう一度お試しください。')
    expect(PAGE).not.toContain("message.includes('slot_conflict')")
    expect(PAGE).not.toContain('cause.status === 409 || cause.status === 422')
    expect(PAGE).not.toContain('API error:')
  })

  test('顧客カルテと通知・自動処理の実績をAPIの値で表示する', () => {
    expect(PAGE).toContain('bookingApi.getCustomerContext')
    expect(PAGE).toContain('customerContext.previousHandover')
    expect(PAGE).toContain('result.line_notification')
    expect(PAGE).toContain('confirmationOperation.status')
    expect(PAGE).toContain('automaticOperations.map')
  })

  test('客の特定は断言せず束ね、空の重複防止キーは作り直す(点検#516軽5)', () => {
    // `customer!` では将来の分岐変更でnullが紛れ込む。空キーで送ると400になる。
    expect(PAGE).not.toContain('customer!.id')
    expect(PAGE).toContain('bookingCustomerId: customer.id')
    expect(PAGE).toContain('booking_customer_id: customer.id')
    expect(PAGE).toContain('idempotencyKey || crypto.randomUUID()')
  })

  test('候補は店舗timezone＋offset付きinstantで送受信する(#651)', () => {
    // 壁時刻の組み立て直し（+09:00 固定）では非JST店舗の予約がずれる。
    // 送信・表示は候補の instant 契約へ統一する。
    expect(API).toContain('timeZone: string;')
    expect(API).toContain('startUtc: string;')
    expect(API).toContain('endUtc: string;')
    expect(BOOKING_TYPES).toContain('startUtc: string;')
    expect(BOOKING_TYPES).toContain('timeZone: string;')
    expect(PAGE).toContain('slotTimeZone')
    // 壁時刻から instant を組み立て直す退路を残さない。
    expect(PAGE).not.toContain('+09:00')
    expect(PAGE).not.toContain('toUtcIso')
  })

  test('確定に使うinstantは再取得した最新枠のもので、欠落・不正は止める(#651)', () => {
    // 入力画面で見えた古い枠の instant は送らない。読み直した枠を持ち、
    // その startUtc だけを送る。読めなければ確定させない。
    expect(PAGE).toContain('const [confirmedSlot, setConfirmedSlot]')
    expect(PAGE).toContain('?.slots.find((slot) => slot.date === date && slot.start === time)')
    expect(PAGE).toContain('setConfirmedSlot(available)')
    expect(PAGE).toContain('const startsAtIso = slotInstant(confirmedSlot)')
    expect(PAGE).toContain('starts_at: startsAtIso')
    expect(PAGE).toContain('この時間の開始時刻を受け取れませんでした。時間を選び直してください。')
    expect(PAGE).toContain('確認した開始時刻が見つかりません。日時を選び直してください。')
    // 選択が変わったら確認済みの枠を捨てる。
    expect(PAGE).toContain('setConfirmedSlot(null)\n  }, [selectionKey])')
  })

  test('電話番号は桁を先に確かめ、再送中の通知状態を取りこぼさない(点検#516の中3・中4)', () => {
    // サーバと同じ約束。出す直前で落とすと入れ直しになる。
    expect(PAGE).toContain('phoneDigitsError')
    expect(PAGE).toContain('電話番号は数字7〜15桁で入力してください')
    expect(PAGE).toContain("normalize('NFKC')")
    // 裏側が返す 'scheduled' を型と文言の両方で受ける。
    expect(API).toContain("'queued' | 'scheduled' | 'succeeded' | 'failed' | 'not_applicable'")
    expect(PAGE).toContain("deliveryStatus === 'scheduled' ? '送信予定です'")
  })
})
