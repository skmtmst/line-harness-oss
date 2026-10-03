// @vitest-environment happy-dom
/*
 * ★V8-B イベント予約の「変更の確認」（板 `hmr2P`）。
 * 処理は useChangeReview で v7 と同じ。見せ方（2列・追従する帯）だけが V8。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1' }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

import ChangeReviewV8 from './change-review-v8'

const v8css = readFileSync(join(process.cwd(), 'src/app/events/change-review/change-review-v8.module.css'), 'utf8')
const v8tsx = readFileSync(join(process.cwd(), 'src/app/events/change-review/change-review-v8.tsx'), 'utf8')

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
})

async function flush() {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

async function renderV8() {
  await act(async () => { root.render(<ChangeReviewV8 eventId="e1" />) })
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

    // 開始日時を30分遅らせる
    const startInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(startInput, '2099-06-01T10:30')
      startInput.dispatchEvent(new Event('input', { bubbles: true }))
      startInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()

    const previewButton = [...document.querySelectorAll('button')].find((b) => b.textContent === '影響を確かめる')
    expect(previewButton, '影響を確かめる口がある').toBeTruthy()
    await act(async () => { previewButton!.click() })
    await flush()
    expect(previewEventChange, '影響の口を叩く').toHaveBeenCalled()
    expect(document.body.textContent).toContain('確定した申込 3人へ')

    const reason = document.querySelector('textarea[aria-label="変える理由"]') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(reason, '会場の都合で時間を30分遅らせます')
      reason.dispatchEvent(new Event('input', { bubbles: true }))
      reason.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()

    const applyButton = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('変えてお知らせする'))
    expect(applyButton, '追従する帯に変える口がある').toBeTruthy()
    await act(async () => { applyButton!.click() })
    await flush()
    expect(applyEventChange, '変える口を叩く').toHaveBeenCalled()
    expect(document.body.textContent).toContain('変えました')
  })

  it('V8 の決まり（layer・色直書きなし・準備中なし）を守る', () => {
    expect(v8css.split('\n')[0]).toContain('@layer properties, theme, base, components, utilities;')
    expect(v8css).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(v8css).not.toMatch(/box-shadow\s*:/)
    expect(v8tsx).toContain('data-design-node="hmr2P"')
    expect(v8tsx).not.toContain('準備中')
  })
})
