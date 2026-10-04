// @vitest-environment happy-dom
/*
 * ★V8-B イベント予約の「申込者」（板 `Mu8qW`）。
 * 開催回ごとの見せ方で、承認・拒否・キャンセル・受付・待ち・CSV・
 * お知らせの口が同じように動くこと。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getEvent = vi.hoisted(() => vi.fn())
const listOccurrenceSelector = vi.hoisted(() => vi.fn())
const getOccurrenceApplicants = vi.hoisted(() => vi.fn())
const decideBooking = vi.hoisted(() => vi.fn())
const adminCancelBooking = vi.hoisted(() => vi.fn())
const updateBooking = vi.hoisted(() => vi.fn())
const promoteOccurrenceWaitlist = vi.hoisted(() => vi.fn())
const previewOccurrenceBroadcast = vi.hoisted(() => vi.fn())
const downloadOccurrenceApplicantsCsv = vi.hoisted(() => vi.fn())
const broadcastsSend = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      broadcasts: { ...actual.api.broadcasts, send: broadcastsSend },
    },
    eventsApi: {
      ...actual.eventsApi,
      getEvent,
      listOccurrenceSelector,
      getOccurrenceApplicants,
      decideBooking,
      adminCancelBooking,
      updateBooking,
      promoteOccurrenceWaitlist,
      previewOccurrenceBroadcast,
      downloadOccurrenceApplicantsCsv,
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a {...(p as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'acc-1',
    accounts: [{ id: 'acc-1', role: 'owner' }],
  }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

import BookingsV8 from './bookings-v8'

const v8css = readFileSync(join(process.cwd(), 'src/app/events/bookings/bookings-v8.module.css'), 'utf8')
const v8tsx = readFileSync(join(process.cwd(), 'src/app/events/bookings/bookings-v8.tsx'), 'utf8')

function applicant(over: Record<string, unknown>) {
  return {
    source: 'booking',
    id: 'b1',
    friendId: 'f1',
    displayName: '山田 太郎',
    pictureUrl: null,
    status: 'requested',
    partySize: 1,
    appliedAt: '2026-10-01T00:00:00.000Z',
    answers: null,
    firstParticipation: { isFirst: true, attendedCount: 0, checkedAt: null },
    offeredAt: null,
    offerExpiresAt: '2026-10-03T03:00:00.000Z',
    ...over,
  }
}

function applicantsPayload() {
  return {
    occurrence: {
      id: 'slot-1',
      eventId: 'e1',
      startsAt: '2026-10-12T05:00:00.000Z',
      endsAt: '2026-10-12T07:00:00.000Z',
      capacity: 20,
      activeSeats: 18,
      version: 2,
    },
    summary: {
      bookingCount: 5,
      waitingCount: 1,
      activeSeats: 18,
      confirmedSeats: 16,
      requestedSeats: 2,
      waitingSeats: 2,
      offeredSeats: 1,
      remainingSeats: 2,
    },
    applicants: [
      applicant({ id: 'b1', status: 'requested' }),
      applicant({ id: 'b2', displayName: '田中 明子', status: 'confirmed', offerExpiresAt: null, firstParticipation: { isFirst: false, attendedCount: 2, checkedAt: null } }),
      applicant({ source: 'waitlist', id: 'w1', displayName: '鈴木 真理', status: 'offered', offerExpiresAt: '2026-10-02T12:00:00.000Z', appliedAt: '2026-09-28T01:12:00.000Z' }),
    ],
    waitlistHistory: [
      {
        id: 'h1',
        friendId: 'f9',
        status: 'cancelled',
        partySize: 1,
        createdAt: '2026-09-27T00:02:00.000Z',
        offeredAt: null,
        offerExpiresAt: null,
        notifiedAt: null,
        updatedAt: '2026-09-29T13:15:00.000Z',
        displayName: '加藤 舞',
        convertedBookingId: null,
      },
    ],
    attendance: { attendedSeats: 9, noShowSeats: 1, entries: [] },
    snapshotId: 'snap-1',
    snapshotExpiresAt: '2099-01-01T00:00:00.000Z',
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  getEvent.mockReset()
  listOccurrenceSelector.mockReset()
  getOccurrenceApplicants.mockReset()
  decideBooking.mockReset()
  broadcastsSend.mockReset()
  previewOccurrenceBroadcast.mockReset()
  getEvent.mockResolvedValue({ id: 'e1', name: '秋のしつけ教室', venue_name: '渋谷ベース 3F', is_published: 1, version: 3 })
  listOccurrenceSelector.mockResolvedValue({
    items: [{ id: 'slot-1', starts_at: '2026-10-12T05:00:00.000Z', ends_at: '2026-10-12T07:00:00.000Z', capacity: 20, is_active: 1 }],
  })
  getOccurrenceApplicants.mockResolvedValue(applicantsPayload())
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
})

async function flush() {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

async function renderV8() {
  await act(async () => { root.render(<BookingsV8 eventId="e1" />) })
  await flush()
}

describe('V8-B 申込者（Mu8qW）', () => {
  it('開催回の見せ方で数と表が出る', async () => {
    await renderV8()
    expect(document.querySelector('[data-design-node="Mu8qW"]'), '板IDの枠がある').toBeTruthy()
    expect(document.body.textContent).toContain('秋のしつけ教室')
    expect(document.body.textContent).toContain('申込者')
    expect(document.body.textContent).toContain('キャンセル待ち')
    expect(document.body.textContent).toContain('キャンセル')
    expect(document.body.textContent).toContain('お知らせを送る')
    expect(document.body.textContent).toContain('初参加')
    expect(document.body.textContent).toContain('過去のイベント参加あり')
    expect(document.body.textContent).toContain('加藤 舞')
  })

  it('承認すると確定の口を叩く', async () => {
    decideBooking.mockResolvedValue({})
    await renderV8()
    const approve = [...document.querySelectorAll('button')].find((b) => b.textContent === '承認する')
    expect(approve, '承認する口がある').toBeTruthy()
    await act(async () => { approve!.click() })
    await flush()
    expect(decideBooking).toHaveBeenCalledWith('acc-1', 'e1', 'b1', 'confirm', undefined)
  })

  it('お知らせは対象を確かめてから送る', async () => {
    previewOccurrenceBroadcast.mockResolvedValue({ broadcastId: 'bc-1', recipientCount: 5 })
    broadcastsSend.mockResolvedValue({})
    await renderV8()
    const input = document.querySelector('input[aria-label="申込者へ送るメッセージ"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '当日は動きやすい服装でお越しください')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    const send = [...document.querySelectorAll('button')].find((b) => b.textContent === '送る')
    await act(async () => { send!.click() })
    await flush()
    expect(previewOccurrenceBroadcast, '対象の確定を叩く').toHaveBeenCalled()
    const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]')
    expect(dialog, '送る前の確認窓が出る').toBeTruthy()
    const confirm = [...dialog!.querySelectorAll('button')].find((b) => b.textContent === '送る')
    await act(async () => { confirm!.click() })
    await flush()
    expect(broadcastsSend, '送信を叩く').toHaveBeenCalledWith('bc-1')
  })

  it('V8 の決まり（layer・色直書きなし・準備中なし）を守る', () => {
    expect(v8css.split('\n')[0]).toContain('@layer properties, theme, base, components, utilities;')
    expect(v8css).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(v8css).not.toMatch(/box-shadow\s*:/)
    expect(v8tsx).toContain('data-design-node="Mu8qW"')
    expect(v8tsx).not.toContain('準備中')
  })
})
