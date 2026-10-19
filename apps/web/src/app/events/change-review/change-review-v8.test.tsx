// @vitest-environment happy-dom
/*
 * ★V8-B イベント予約の「変更の確認」（板 ）。
 * 現役の入力・自動の影響確認・人数付きの確認窓を通して変更する。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { changeEventStart } from '@/test-utils/event-change'

const getEvent = vi.hoisted(() => vi.fn())
const listSlots = vi.hoisted(() => vi.fn())
const previewEventChange = vi.hoisted(() => vi.fn())
const applyEventChange = vi.hoisted(() => vi.fn())

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

vi.mock('next/link', () => ({
  default: ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a {...(p as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}))

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(), useSearchParams: () => new URLSearchParams('id=e1') }))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1' }),
}))

vi.mock('@/components/shell/page-chrome', async () => ({ ...(await import('@/test-utils/page-chrome-mock')).pageChromeMock(),
  usePageTitle: () => {},
}))

import ChangeReviewV8 from '@/v8/events/change-review'

const v8css = readFileSync(join(process.cwd(), 'src/v8/events/change-review.module.css'), 'utf8')
const v8tsx = readFileSync(join(process.cwd(), 'src/v8/events/change-review.tsx'), 'utf8')

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

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
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
  document.body.innerHTML = ''
  delete document.documentElement.dataset.theme
})

async function flush() {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

async function renderV8() {
  await act(async () => { root.render(<ChangeReviewV8 />) })
  await flush()
}

describe('V8-B 変更の確認（hmr2P）', () => {
  it('2列の見せ方で同じ処理が動く', async () => {
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
    await renderV8()
    expect(document.querySelector('[data-design-node="hmr2P"]'), '板IDの枠がある').toBeTruthy()
    expect(document.body.textContent).toContain('変更の確認：秋のしつけ教室')

    await changeEventStart('10:30')
    expect(previewEventChange, '影響の口を叩く').toHaveBeenCalled()
    expect(document.body.textContent).toContain('確定した申込 3 人へ')

    const reason = document.querySelector<HTMLInputElement>('#ev-cr-reason')!
    await act(async () => {
      fireEvent.change(reason, { target: { value: '会場の都合で時間を30分遅らせます' } })
    })
    await flush()

    const applyButton = [...document.querySelectorAll('button')].find((b) => b.textContent === '変えてお知らせする')
    expect(applyButton, '追従する帯に変える口がある').toBeTruthy()
    await act(async () => { applyButton!.click() })
    await flush()
    expect(applyEventChange).not.toHaveBeenCalled()
    // 確認の窓が出て、人数入りの確定押しで変える口を叩く。
    expect(document.querySelector('[data-design-node="qUdNh"]'), '確認の窓の印がある').toBeTruthy()
    const confirmButton = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('人にお知らせする'))
    expect(confirmButton, '確認の窓に確定の押しがある').toBeTruthy()
    expect(confirmButton!.querySelector('svg.lucide-send'), 'お知らせする操作に紙飛行機がある').toBeTruthy()
    await act(async () => { confirmButton!.click() })
    await flush()
    expect(applyEventChange, '変える口を叩く').toHaveBeenCalled()
    expect(document.body.textContent).toContain('変えました')
  })

  it('V8 の型・色直書きなし・準備中なしを守る', () => {
    expect(v8tsx).toContain("import { CreatePage } from '@/components/templates'")
    expect(v8css).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    // 影は共通のカードの影だけ（2026-10-09 オーナー採用 ）。ほかの影は直書きしない。
    expect(v8css.replace(/box-shadow:\s*(?:var\(--(?:card-shadow|shadow-row-line)\)|none)/g, '')).not.toMatch(/box-shadow\s*:/)
    expect(v8tsx).toMatch(/(?:data-design-node|boardId)="hmr2P"/)
    expect(v8tsx).not.toContain('準備中')
  })
})
