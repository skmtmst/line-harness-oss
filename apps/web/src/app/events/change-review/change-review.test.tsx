// @vitest-environment happy-dom
/*
 * U-1 変更の確認の描画試験。主な状態（空にあたる未指定・読み込み中・
 * 失敗・正常）と、影響の確かめ→理由→適用の流れを守る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getEvent = vi.hoisted(() => vi.fn())
const listSlots = vi.hoisted(() => vi.fn())
const previewEventChange = vi.hoisted(() => vi.fn())
const applyEventChange = vi.hoisted(() => vi.fn())
const searchParams = vi.hoisted(() => ({ value: 'id=e1' }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    eventsApi: {
      ...actual.eventsApi,
      getEvent,
      listSlots,
      previewEventChange,
      applyEventChange,
    },
  }
})

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(searchParams.value),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a {...(p as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1' }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import EventChangeReviewPage from './page'

let host: HTMLDivElement
let root: Root

const EVENT = {
  id: 'e1',
  name: '秋のしつけ教室',
  venue_name: '店内スペース',
  venue_url: null,
  is_published: 1,
  version: 3,
}

const SLOTS = [
  {
    id: 'slot-1',
    event_id: 'e1',
    starts_at: '2099-06-01T01:00:00.000Z',
    ends_at: '2099-06-01T02:00:00.000Z',
    capacity: 10,
    is_active: 1,
    sort_order: 1,
  },
]

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  searchParams.value = 'id=e1'
  getEvent.mockReset()
  listSlots.mockReset()
  previewEventChange.mockReset()
  applyEventChange.mockReset()
  getEvent.mockResolvedValue(EVENT)
  listSlots.mockResolvedValue({ items: SLOTS })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function renderPage() {
  await act(async () => { root.render(<EventChangeReviewPage />) })
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

function buttons(): HTMLButtonElement[] {
  return [...host.querySelectorAll('button')] as HTMLButtonElement[]
}

function buttonByText(text: string): HTMLButtonElement {
  const found = buttons().find((button) => button.textContent === text)
  if (!found) throw new Error(`button not found: ${text}`)
  return found
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

describe('U-1 変更の確認', () => {
  it('idが無いときは選び直しだけを出す', async () => {
    searchParams.value = ''
    await renderPage()
    expect(host.textContent).toContain('確認するイベントが指定されていません')
    expect(host.textContent).toContain('イベント一覧へ戻る')
  })

  it('読み込みに失敗したら開き直しを出す', async () => {
    getEvent.mockRejectedValueOnce(new Error('down'))
    await renderPage()
    expect(host.textContent).toContain('開き直す')
  })

  it('影響を確かめて理由を書いて変える', async () => {
    previewEventChange.mockResolvedValue({
      event_id: 'e1',
      impacts: [
        {
          slot_id: 'slot-1',
          starts_at: '2099-06-01T01:00:00.000Z',
          ends_at: '2099-06-01T02:00:00.000Z',
          capacity: 10,
          confirmed_seats: 3,
          waiting_seats: 1,
          pending_reminders: 2,
          errors: [],
          notices: ['datetime_moved_with_bookings'],
        },
      ],
      event_notices: [],
      blocked: false,
      total_confirmed: 3,
      total_waiting: 1,
      total_pending_reminders: 2,
    })
    applyEventChange.mockResolvedValue({
      success: true,
      version: 4,
      log_id: 'log-1',
      affected_confirmed: 3,
      affected_waiting: 1,
      notified: 3,
    })
    await renderPage()
    expect(host.textContent).toContain('秋のしつけ教室')
    expect(host.textContent).toContain('影響を確かめる')

    // 開始日時を30分遅らせる
    const startInput = host.querySelector('input[type="datetime-local"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(startInput, '2099-06-01T10:30')
      startInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonByText('影響を確かめる'))

    expect(previewEventChange).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('確定 3人・待ち 1人に影響します')
    expect(host.textContent).toContain('日時が動きます')

    // 主役の緑の塗りボタンは「この内容で変える」1つだけ。
    const applyButtons = buttons().filter((button) => button.textContent === 'この内容で変える')
    expect(applyButtons).toHaveLength(1)

    const reason = host.querySelector('textarea[aria-label="変える理由"]') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(reason, '会場の都合で30分遅らせます')
      reason.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonByText('この内容で変える'))

    expect(applyEventChange).toHaveBeenCalledWith('acc-1', 'e1', expect.objectContaining({
      expected_version: 3,
      change_reason: '会場の都合で30分遅らせます',
      idempotency_key: expect.any(String),
    }))
    expect(host.textContent).toContain('変えました')
    expect(host.textContent).toContain('LINEのお知らせは 3人に送りました')
  })

  it('止まる理由があるときは変えるボタンを出さない', async () => {
    previewEventChange.mockResolvedValue({
      event_id: 'e1',
      impacts: [
        {
          slot_id: 'slot-1',
          starts_at: '2099-06-01T01:00:00.000Z',
          ends_at: '2099-06-01T02:00:00.000Z',
          capacity: 10,
          confirmed_seats: 8,
          waiting_seats: 0,
          pending_reminders: 0,
          errors: ['slot_capacity_below_bookings'],
          notices: [],
        },
      ],
      event_notices: [],
      blocked: true,
      total_confirmed: 8,
      total_waiting: 0,
      total_pending_reminders: 0,
    })
    await renderPage()
    const capacityInput = host.querySelector('input[type="number"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(capacityInput, '2')
      capacityInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonByText('影響を確かめる'))

    expect(host.textContent).toContain('定員を、すでに申し込まれている人数より下げられません')
    expect(buttons().some((button) => button.textContent === 'この内容で変える')).toBe(false)
  })
})
