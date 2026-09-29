// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebinarNotificationOverview } from '@/lib/api'
import WebinarNotifications from './webinar-notifications'

/*
 * #745 — 見送りの内訳を画面に出す。
 *
 * 「見送り 5件」だけでは取るべき行動が決まらない。**すでに視聴済み**は
 * 正常だが、**対象回が終了済み**は届かないまま終わったということで、
 * 運用者が気づく必要がある。本物の React で描いて確かめる。
 */

const net = vi.hoisted(() => ({
  notifications: vi.fn(),
}))

vi.mock('../../lib/api', async (importOriginal: () => Promise<typeof import('../../lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    webinarApi: { ...actual.webinarApi, notifications: (...args: unknown[]) => net.notifications(...args) },
  }
})

vi.mock('../shared/list-state', () => ({ default: () => null }))

const overview = (over: Partial<WebinarNotificationOverview> = {}): WebinarNotificationOverview => ({
  total: 10, pending: 2, sent: 3, failed: 0, skipped: 0, cancelled: 0,
  skippedReasons: [],
  audience: { people: 5, bookings: 5, definition: 'active_registrations' },
  ...over,
})

const settings = {
  version: 1,
  registrationEnabled: true, dayBeforeEnabled: true, dayBeforeTime: '20:00',
  hourBeforeEnabled: true, hourBeforeMinutes: 60, startEnabled: true,
  missedEnabled: true, missedTime: '10:00', completedEnabled: true,
} as never

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  net.notifications.mockReset()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.restoreAllMocks()
})

async function show(data: WebinarNotificationOverview) {
  net.notifications.mockResolvedValue({ data: { settings, overview: data } })
  await act(async () => {
    root.render(<WebinarNotifications webinarId="w1" />)
  })
}

describe('見送りの内訳（#745）', () => {
  it('理由と件数を並べて出す', async () => {
    await show(overview({
      skipped: 4,
      skippedReasons: [
        { code: 'notification_expired', label: '対象回が終了済み', count: 3 },
        { code: 'already_viewed', label: 'すでに視聴済み', count: 1 },
      ],
    }))

    const panel = host.querySelector('[data-testid="webinar-skip-reasons"]')
    expect(panel, '見送りの内訳が出ていない').not.toBeNull()
    const rows = [...panel!.querySelectorAll('li')].map((li) => li.textContent)
    expect(rows).toEqual(['対象回が終了済み3件', 'すでに視聴済み1件'])
  })

  it('見送りが無いときは枠ごと出さない', async () => {
    /* 常に空の枠があると、誰も見なくなる。 */
    await show(overview({ skipped: 0, skippedReasons: [] }))
    expect(host.querySelector('[data-testid="webinar-skip-reasons"]')).toBeNull()
  })

  it('合計だけで内訳が無いときも、合計は出す', async () => {
    /* 古い返事（内訳を持たない）でも画面が壊れないこと。 */
    await show(overview({ skipped: 2, skippedReasons: [] }))
    expect(host.textContent).toContain('見送り')
    expect(host.querySelector('[data-testid="webinar-skip-reasons"]')).toBeNull()
  })
})
