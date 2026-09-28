// @vitest-environment happy-dom
/*
 * R217: イベント一覧にイベント本体の削除口が無かった回帰試験。
 *
 * 以前は枠（日時）の削除しかできず、作りかけ・終わったイベントを
 * 運用者が自分で片付けられなかった。見る筋書き:
 *   1. owner/admin の行メニューに「イベントを削除」が出る（staff には出ない）
 *   2. 確認窓は右上の×で閉じられる
 *   3. 削除すると一覧を読み直す
 *   4. 申込が残るイベントは 409 で止まり、理由が窓に出る
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventListItem } from '@/lib/api'

const listEvents = vi.hoisted(() => vi.fn())
const deleteEvent = vi.hoisted(() => vi.fn())
const staffMe = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: staffMe },
    },
    eventsApi: { ...actual.eventsApi, listEvents, deleteEvent },
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
  deleteEvent.mockReset()
  staffMe.mockReset()
  listEvents.mockResolvedValue(listPayload())
  deleteEvent.mockResolvedValue(undefined)
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

/** 行の「⋯」を開いて、メニュー項目を文字で探す。無ければ null。 */
async function openRowMenu(): Promise<HTMLElement | null> {
  const menuButton = document.querySelector<HTMLElement>('button[aria-label*="その他操作"], button[aria-label*="そのほかの操作"]')
  if (!menuButton) return null // 追加項目が無い行には「⋯」自体が出ない
  await act(async () => { menuButton.click() })
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((m) => m.textContent?.includes('イベントを削除')) ?? null
}

describe('R217 イベント本体の削除口', () => {
  it('owner の行メニューに「イベントを削除」がある', async () => {
    await renderPage()
    expect(await openRowMenu(), '削除の項目がある').toBeTruthy()
  })

  it('staff には削除の項目を出さない（サーバ側も owner/admin 限定）', async () => {
    staffMe.mockResolvedValue(staffPayload('staff'))
    await renderPage()
    expect(await openRowMenu(), 'staff には削除を出さない').toBeNull()
  })

  it('確認窓は右上の×で閉じられ、削除は実行されない', async () => {
    await renderPage()
    const deleteItem = await openRowMenu()
    await act(async () => { deleteItem!.click() })

    const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]')
    expect(dialog, '確認窓が出る').toBeTruthy()
    expect(document.body.textContent).toContain('を削除しますか')
    const close = document.querySelector<HTMLElement>('[aria-label="閉じる"]')
    expect(close, '右上の×がある').toBeTruthy()
    await act(async () => { close!.click() })
    await flush()
    expect(deleteEvent).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull()
  })

  it('削除するとAPIを呼び、一覧を読み直す', async () => {
    await renderPage()
    const callsBefore = listEvents.mock.calls.length
    const deleteItem = await openRowMenu()
    await act(async () => { deleteItem!.click() })

    const confirm = [...document.querySelectorAll<HTMLElement>('button')]
      .find((b) => b.textContent?.trim() === '削除する')
    expect(confirm, '「削除する」がある').toBeTruthy()
    await act(async () => { confirm!.click() })
    await flush()

    expect(deleteEvent).toHaveBeenCalledWith('acc-1', 'e1')
    expect(listEvents.mock.calls.length).toBeGreaterThan(callsBefore)
    expect(document.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull()
  })

  it('申込が残るイベントは 409 で止まり、理由が窓に残る', async () => {
    deleteEvent.mockRejectedValue(new ApiError(409, 'conflict', 'event_has_active_bookings'))
    await renderPage()
    const deleteItem = await openRowMenu()
    await act(async () => { deleteItem!.click() })
    const confirm = [...document.querySelectorAll<HTMLElement>('button')]
      .find((b) => b.textContent?.trim() === '削除する')
    await act(async () => { confirm!.click() })
    await flush()

    expect(document.body.textContent).toContain('削除できません')
    // 窓は開いたまま（勝手に消えて失敗が見えなくならない）
    expect(document.querySelector('[role="dialog"], [role="alertdialog"]')).toBeTruthy()
  })
})
