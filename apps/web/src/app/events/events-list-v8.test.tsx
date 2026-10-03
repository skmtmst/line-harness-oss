// @vitest-environment happy-dom
/*
 * ★V8-B イベント予約の一覧（板 `e2ekFu`）。
 * v7（`page.tsx` の EventsListPageV7）とは別の部品 `events-list-v8.tsx` が、
 * 同じ口（取得・絞り込み・ページ送り・削除）で V8 の置き場になること。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type EventListItem } from '@/lib/api'

const v8css = readFileSync(join(process.cwd(), 'src/app/events/events-list-v8.module.css'), 'utf8')
const v8tsx = readFileSync(join(process.cwd(), 'src/app/events/events-list-v8.tsx'), 'utf8')

const fetchApi = vi.hoisted(() => vi.fn())
const deleteEvent = vi.hoisted(() => vi.fn())
const staffMe = vi.hoisted(() => vi.fn())
const foldersList = vi.hoisted(() => vi.fn())
const routerPush = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchApi,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: staffMe },
      folders: { ...actual.api.folders, list: foldersList },
    },
    eventsApi: { ...actual.eventsApi, deleteEvent },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a {...(p as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1' }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

import EventsListV8 from './events-list-v8'

function item(over: Partial<EventListItem>): EventListItem {
  return {
    id: 'e1',
    name: '秋のしつけ教室（第1回）',
    venue_name: '渋谷ベース 3F',
    venue_url: null,
    image_url: null,
    description: null,
    description_centered: 0,
    max_bookings_per_friend: null,
    requires_approval: 1,
    approval_deadline_hours: 24,
    cancel_deadline_hours_before: null,
    reminder_day_before_enabled: 1,
    reminder_hours_before: null,
    is_published: 1,
    lifecycle_status: 'published',
    sort_order: 0,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    version: 1,
    next_slot_starts_at: '2026-10-12T05:00:00.000Z',
    total_capacity: 20,
    total_active: 18,
    pending_count: 2,
    visible_tag_id: null,
    visible_tag_name: null,
    ...over,
  }
}

function listPayload() {
  return {
    items: [item({ id: 'e1' })],
    total: 1,
    summary: {
      upcoming_slots: 9,
      upcoming_active: 29,
      upcoming_capacity: 60,
      fill_rate: 48,
      nearly_full: 1,
      low_applications: 1,
      nearest_upcoming_starts_at: '2026-10-12T05:00:00.000Z',
      nearest_low_starts_at: null,
    },
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  fetchApi.mockReset()
  deleteEvent.mockReset()
  staffMe.mockReset()
  foldersList.mockReset()
  routerPush.mockReset()
  fetchApi.mockImplementation(async (url: string) => {
    if (url.includes('filter=pending')) return { items: [], total: 0 }
    return listPayload()
  })
  staffMe.mockResolvedValue({ success: true, data: { role: 'owner' } })
  foldersList.mockResolvedValue({ success: true, data: [] })
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

async function renderList() {
  await act(async () => { root.render(<EventsListV8 />) })
  await flush()
}

describe('V8-B イベント予約の一覧（e2ekFu）', () => {
  it('外枠に板IDを持ち、題と数の帯が出る', async () => {
    await renderList()
    expect(document.querySelector('[data-design-node="e2ekFu"]'), '板IDの枠がある').toBeTruthy()
    expect(document.body.textContent).toContain('イベント予約')
    expect(document.body.textContent).toContain('これからの回')
    expect(document.body.textContent).toContain('申し込みが少ない')
  })

  it('行の「…」に中身・申込者・プレビュー・削除がそろう', async () => {
    await renderList()
    const menuButton = document.querySelector<HTMLElement>('button[aria-label$="の操作"]')
    expect(menuButton, '行末の「…」がある').toBeTruthy()
    await act(async () => { menuButton!.click() })
    await flush()
    const labels = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((m) => m.textContent)
    expect(labels.some((t) => t?.includes('中身を見る')), '中身を見る').toBe(true)
    expect(labels.some((t) => t?.includes('申込者を見る')), '申込者を見る').toBe(true)
    expect(labels.some((t) => t?.includes('プレビュー')), 'プレビュー').toBe(true)
    expect(labels.some((t) => t?.includes('削除する')), '削除する').toBe(true)
    expect(labels.some((t) => t?.includes('複製')), '複製口は無いので出さない').toBe(false)
  })

  it('403 は権限不足の1枚になり、再読み込み口は出ない', async () => {
    fetchApi.mockImplementation(async (url: string) => {
      if (url.includes('filter=pending')) return { items: [], total: 0 }
      throw new ApiError(403, 'forbidden')
    })
    await renderList()
    expect(document.body.textContent).toContain('権限がありません')
    expect(document.body.textContent).not.toContain('再読み込み')
  })

  it('V8 の決まり（layer・色直書きなし・準備中なし）を守る', () => {
    expect(v8css.split('\n')[0]).toContain('@layer properties, theme, base, components, utilities;')
    expect(v8css).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(v8css).not.toMatch(/box-shadow\s*:/)
    expect(v8tsx).toContain('data-design-node="e2ekFu"')
    expect(v8tsx).not.toContain('準備中')
  })
})
