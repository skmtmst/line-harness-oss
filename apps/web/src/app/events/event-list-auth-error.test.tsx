// @vitest-environment happy-dom
/*
 * R601: イベント一覧の 403（権限不足）と 503（通信失敗）を言い分ける。
 *
 * 以前はどちらも同じ「通信失敗・再読み込み」の1枚だった。権限が無い人が
 * 通信環境を調べたり何度も読み直したりしてしまう。見る筋書き:
 *   1. 403 は権限不足の1枚（管理者への依頼、再読み込み口なし）
 *   2. 503 は通信失敗の1枚（再読み込み口あり）
 *   3. 404 も通信失敗側（再読み込み口あり）
 *   4. 正常・空は今までどおり
 *   5. 503 のあと再読み込みで直れば一覧に戻る
 *   6. 失敗時の件数は「—」（0件と読ませない）
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventListItem } from '@/lib/api'

const listEvents = vi.hoisted(() => vi.fn())
const staffMe = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: staffMe },
    },
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

import { ApiError } from '@/lib/api'
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

function listPayload() {
  return {
    items: [item({ id: 'e1' })],
    total: 1,
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
  }
}

function staffPayload(role: string) {
  return {
    success: true,
    data: {
      id: 'me',
      name: '運用者',
      email: null,
      role,
      lineLinked: false,
      twoFactorEnabled: false,
      isActive: true,
      permissionKeys: [],
      notificationPreferences: {},
      inviteStatus: 'active',
      createdAt: '',
      updatedAt: '',
      assignedLineAccountId: null,
      canAccessDescendantAccounts: false,
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
  listEvents.mockReset()
  staffMe.mockReset()
  staffMe.mockResolvedValue(staffPayload('owner'))
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

async function renderPage() {
  await act(async () => { root.render(<EventsListPage />) })
  await flush()
}

function bodyText(): string {
  return document.body.textContent ?? ''
}

function retryButton(): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>('button')]
    .find((b) => b.textContent?.includes('再読み込み')) ?? null
}

describe('R601 イベント一覧の権限不足と通信失敗の言い分け', () => {
  it('403 は権限不足の1枚で、管理者への依頼を出し、再読み込み口は出さない', async () => {
    listEvents.mockRejectedValue(new ApiError(403, 'forbidden'))
    await renderPage()
    expect(bodyText()).toContain('イベントを見る権限がありません')
    expect(bodyText()).toContain('管理者')
    expect(retryButton(), '押しても直らない再読み込みは出さない').toBeNull()
  })

  it('503 は通信失敗の1枚で、再読み込み口を出す', async () => {
    listEvents.mockRejectedValue(new ApiError(503, 'Service Unavailable'))
    await renderPage()
    expect(bodyText()).toContain('登録したイベントは消えていません')
    expect(bodyText()).not.toContain('権限がありません')
    expect(retryButton(), '通信失敗は読み直せる').toBeTruthy()
  })

  it('404 も通信失敗側の1枚で、再読み込み口を出す', async () => {
    listEvents.mockRejectedValue(new ApiError(404, 'not found'))
    await renderPage()
    expect(bodyText()).toContain('登録したイベントは消えていません')
    expect(bodyText()).not.toContain('権限がありません')
    expect(retryButton()).toBeTruthy()
  })

  it('正常は行が出る', async () => {
    listEvents.mockResolvedValue(listPayload())
    await renderPage()
    expect(bodyText()).toContain('体験レッスン')
  })

  it('空は「まだありません」と作る口が出る', async () => {
    listEvents.mockResolvedValue({ items: [], total: 0, limit: 20, sort: [] })
    await renderPage()
    expect(bodyText()).toContain('イベントがまだありません')
  })

  it('503 のあと再読み込みで直れば一覧に戻る', async () => {
    listEvents.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'))
    listEvents.mockResolvedValue(listPayload())
    await renderPage()
    expect(bodyText()).toContain('登録したイベントは消えていません')
    const retry = retryButton()
    expect(retry, '再読み込み口がある').toBeTruthy()
    await act(async () => { retry!.click() })
    await flush()
    expect(bodyText()).toContain('体験レッスン')
  })

  it('403 のとき件数は「—」（0件と読ませない）', async () => {
    listEvents.mockRejectedValue(new ApiError(403, 'forbidden'))
    await renderPage()
    expect(bodyText()).toContain('—')
    expect(bodyText()).not.toContain('0件')
  })
})
