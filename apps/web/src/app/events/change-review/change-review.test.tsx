// @vitest-environment happy-dom
/*
 * U-1 変更の確認の描画試験。主な状態（空にあたる未指定・読み込み中・
 * 失敗・正常）と、影響の確かめ→理由→適用の流れを守る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { changeEventStart, waitEventPreview } from '@/test-utils/event-change'

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

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
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

vi.mock('@/components/shell/page-chrome', async () => ({ ...(await import('@/test-utils/page-chrome-mock')).pageChromeMock(),
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
  document.documentElement.dataset.theme = 'v8'
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
  delete document.documentElement.dataset.theme
})

async function renderPage() {
  await act(async () => { root.render(<EventChangeReviewPage />) })
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')] as HTMLButtonElement[]
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
    await changeEventStart('10:30')

    expect(previewEventChange).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('確定した申込 3 人へ')
    expect(host.textContent).toContain('キャンセル待ち 1 人')
    expect(host.textContent).toContain('日時が変わります')

    // 主役の緑の塗りボタンは「この内容で変える」1つだけ。
    const applyButtons = buttons().filter((button) => button.textContent === '変えてお知らせする')
    expect(applyButtons).toHaveLength(1)

    const reason = host.querySelector<HTMLInputElement>('#ev-cr-reason')!
    await act(async () => {
      fireEvent.change(reason, { target: { value: '会場の都合で30分遅らせます' } })
    })
    await click(buttonByText('変えてお知らせする'))
    expect(applyEventChange).not.toHaveBeenCalled()
    expect(document.querySelector('[data-design-node="qUdNh"]')).toBeTruthy()
    await click(buttonByText('変えて 3 人にお知らせする'))

    expect(applyEventChange).toHaveBeenCalledWith('acc-1', 'e1', expect.objectContaining({
      expected_version: 3,
      change_reason: '会場の都合で30分遅らせます',
      idempotency_key: expect.any(String),
    }))
    expect(host.textContent).toContain('変えました')
    expect(host.textContent).toContain('LINE のお知らせは 3 人に送りました')
  })

  it('止まる理由があるときは変更できず、APIも呼ばない', async () => {
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
    const capacityInput = host.querySelector('#ev-cr-cap') as HTMLInputElement
    await act(async () => {
      fireEvent.change(capacityInput, { target: { value: '2' } })
    })
    await waitEventPreview()

    expect(host.textContent).toContain('定員を、すでに申し込まれている人数より下げられません')
    expect(buttonByText('変えてお知らせする').disabled).toBe(true)
    await click(buttonByText('変えてお知らせする'))
    expect(applyEventChange).not.toHaveBeenCalled()
  })
})
