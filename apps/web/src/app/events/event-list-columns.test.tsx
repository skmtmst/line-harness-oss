// @vitest-environment happy-dom
/*
 * 撮影指摘（m19d）：/events 一覧で「申込条件」と「状態」の見出しが重なり、
 * 「全員」が1文字ずつ縦に折れていた。申込条件は状態の札の下へ畳み、
 * 幅の無い列を作らない。見る筋書き:
 *   1. 見出しに「申込条件」は無く、「状態」がある
 *   2. 状態のますに札と条件の両方が入る（受付中＋全員、終了＋タグ名）
 *   3. 条件の文字は折れない（truncate＝1行省略）し、タグ名は title で全文を確認できる
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventListItem } from '@/lib/api'

const listEvents = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    eventsApi: { ...actual.eventsApi, listEvents },
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

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import EventsListPage from './page'

function item(over: Partial<EventListItem>): EventListItem {
  return {
    id: 'e1',
    name: '体験レッスン',
    venue_name: null,
    venue_url: null,
    image_url: null,
    description: null,
    description_centered: 0,
    max_bookings_per_friend: null,
    requires_approval: 0,
    approval_deadline_hours: 24,
    cancel_deadline_hours_before: null,
    reminder_day_before_enabled: 1,
    reminder_hours_before: null,
    is_published: 1,
    sort_order: 0,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    version: 1,
    next_slot_starts_at: '2099-06-01T01:00:00.000Z',
    total_capacity: 10,
    total_active: 3,
    pending_count: 0,
    visible_tag_id: null,
    visible_tag_name: null,
    ...over,
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  listEvents.mockReset()
  listEvents.mockResolvedValue({
    items: [
      item({ id: 'e1' }),
      item({
        id: 'e2',
        name: '絞り込み説明会',
        next_slot_starts_at: null,
        total_capacity: 5,
        total_active: 5,
        visible_tag_id: 't1',
        visible_tag_name: '定期便の契約がある人だけの長いタグ名',
      }),
    ],
    total: 2,
    limit: 20,
    sort: [],
    summary: {
      upcoming_slots: 1,
      upcoming_active: 3,
      upcoming_capacity: 10,
      fill_rate: 30,
      nearly_full: 0,
      low_applications: 0,
      nearest_upcoming_starts_at: '2099-06-01T01:00:00.000Z',
      nearest_low_starts_at: null,
    },
  })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function renderPage() {
  await act(async () => { root.render(<EventsListPage />) })
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

describe('m19d 一覧の状態ますに申込条件を畳む', () => {
  it('見出しに申込条件は無く、状態のますに札と条件が両方入る', async () => {
    await renderPage()
    const heads = [...document.querySelectorAll('th')].map((th) => th.textContent?.trim())
    expect(heads).not.toContain('申込条件')
    expect(heads).toContain('状態')
    const rows = [...document.querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(2)
    // 状態のますは後ろから2番目（最後は操作）。
    const stateOf = (row: Element) => row.querySelectorAll('td')[4]
    expect(stateOf(rows[0]).textContent).toContain('受付中')
    expect(stateOf(rows[0]).textContent).toContain('全員')
    expect(stateOf(rows[1]).textContent).toContain('終了')
    expect(stateOf(rows[1]).textContent).toContain('定期便の契約がある人だけの長いタグ名')
  })

  it('条件の文字は折れず、タグ名は title で全文を確認できる', async () => {
    await renderPage()
    const rows = [...document.querySelectorAll('tbody tr')]
    const stateOf = (row: Element) => row.querySelectorAll('td')[4]
    for (const row of rows) {
      const condition = stateOf(row).querySelectorAll('span')[1]
      // truncate（折らずに1行で省略）が無いと、狭い器で1文字ずつ縦に折れる。
      expect(condition.className).toContain('truncate')
    }
    const tag = stateOf(rows[1]).querySelector('[title]')
    expect(tag?.getAttribute('title')).toBe('定期便の契約がある人だけの長いタグ名')
  })
})
