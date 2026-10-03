// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import BookingDayTimeline from './booking-day-v8'
import type { BookingTodayRow } from '@/lib/api'

/*
 * 予約管理の「日」（時刻順）（B-1 `AlwZz`・`V8TfD`）の契約。
 * 時刻の帯・数のタイル・その場の印（来店した／遅れる／…の中の来なかった）・
 * 印の取り消し・右の待ちの列が出ることを実DOMで固定する。
 */

const rows: BookingTodayRow[] = [
  {
    kind: 'staff',
    id: 'booking-1',
    starts_at: '2026-10-04T05:00:00.000Z',
    ends_at: '2026-10-04T06:00:00.000Z',
    status: 'confirmed',
    price_at_booking: 5000,
    friend_id: 'friend-a',
    booking_customer_id: null,
    menu_id: 'menu-a',
    menu_name: 'カット',
    staff_id: 'staff-a',
    staff_name: '太郎',
    customer_name: '花子',
    visit_mark: null,
  },
  {
    kind: 'staff',
    id: 'booking-2',
    starts_at: '2026-10-04T06:00:00.000Z',
    ends_at: '2026-10-04T07:00:00.000Z',
    status: 'completed',
    price_at_booking: 5000,
    friend_id: 'friend-b',
    booking_customer_id: null,
    menu_id: 'menu-a',
    menu_name: 'カット',
    staff_id: 'staff-a',
    staff_name: '太郎',
    customer_name: '次郎',
    visit_mark: { kind: 'visited', late_minutes: null, marked_by_name: '店長', marked_at: '2026-10-04T06:05:00.000Z' },
  },
]

const waitlist = [
  {
    id: 'wait-1',
    startsAt: '2026-10-04T06:00:00.000Z',
    title: '山本',
    sub: 'カット',
    status: 'waiting' as const,
    holdExpiresAt: null,
    position: 1,
  },
]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

function renderTimeline(overrides?: Partial<React.ComponentProps<typeof BookingDayTimeline>>) {
  const onMark = overrides?.onMark ?? (async () => true)
  const onUnmark = overrides?.onUnmark ?? (async () => true)
  act(() => {
    root.render(
      <BookingDayTimeline
        rows={rows}
        waitlist={waitlist}
        waitlistTitle="キャンセル待ち"
        waitlistNote="空いたら登録の早い順に自動で1人ずつ知らせる。"
        loading={false}
        now={new Date('2026-10-04T04:30:00.000Z')}
        showNowLine
        busyId={null}
        onMark={onMark}
        onUnmark={onUnmark}
      />,
    )
  })
  return { onMark, onUnmark }
}

test('時刻の帯・数のタイル・待ちの列が出る', () => {
  renderTimeline()
  // 時刻は日本時間。
  expect(container.textContent).toContain('14:00')
  expect(container.textContent).toContain('花子')
  expect(container.textContent).toContain('カット・担当 太郎')
  // 数のタイル。
  expect(container.textContent).toContain('予約')
  // いまの線。
  expect(container.textContent).toContain('いま 13:30')
  // 右の待ちの列。
  expect(container.textContent).toContain('キャンセル待ち')
  expect(container.textContent).toContain('山本')
})

test('来店したを押すと印が付き、取り消すで戻せる', async () => {
  const onMark = vi.fn(async () => true)
  const onUnmark = vi.fn(async () => true)
  renderTimeline({ onMark, onUnmark })
  const buttons = [...container.querySelectorAll('button')].filter((button) => button.textContent === '来店した')
  expect(buttons.length).toBeGreaterThan(0)
  await act(async () => { buttons[0].click() })
  expect(onMark).toHaveBeenCalledWith(expect.objectContaining({ id: 'booking-1' }), 'visited', undefined)
  // 印ずみは取り消すが出る。
  const undo = [...container.querySelectorAll('button')].filter((button) => button.textContent === '取り消す')
  expect(undo.length).toBeGreaterThan(0)
  await act(async () => { undo[0].click() })
  expect(onUnmark).toHaveBeenCalled()
})

test('来なかったは「…」の中', async () => {
  const onMark = vi.fn(async () => true)
  renderTimeline({ onMark })
  const more = [...container.querySelectorAll('button')].filter((button) => button.textContent === '…')
  expect(more.length).toBeGreaterThan(0)
  await act(async () => { more[0].click() })
  const noShow = [...document.body.querySelectorAll('button')].filter((button) => button.textContent === '来なかった')
  expect(noShow.length).toBeGreaterThan(0)
  await act(async () => { noShow[0].click() })
  expect(onMark).toHaveBeenCalledWith(expect.objectContaining({ id: 'booking-1' }), 'no_show', undefined)
})
