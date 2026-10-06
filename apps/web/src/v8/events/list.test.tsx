// @vitest-environment happy-dom
/*
 * V8 イベント予約の一覧（src/v8/events/list.tsx）の動きの試験。BEHAVIOR.md の決まりを守る。
 * 見るだけの人には「イベントを作る」を置かず閲覧のみの帯を出す・統括には置く・行の名前の前にフォルダの丸。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const fetchApi = vi.hoisted(() => vi.fn())
const listFolders = vi.hoisted(() => vi.fn())
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const api = (actual as unknown as { api: Record<string, object> }).api
  return { ...actual, fetchApi, api: { ...api, folders: { ...api.folders, list: listFolders } } }
})
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role.value }
})

import EventsListV8 from './list'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const event = {
  id: 'ev-1', name: '秋のしつけ教室', venue_name: '渋谷ベース 3F', venue_url: null, image_url: null, description: null,
  description_centered: 0, max_bookings_per_friend: 1, requires_approval: 1, approval_deadline_hours: 24,
  cancel_deadline_hours_before: 24, reminder_day_before_enabled: 1, reminder_hours_before: null, is_published: 1,
  lifecycle_status: 'published', folderId: 'folder-class', sort_order: 1, created_at: '2026-09-01', updated_at: '2026-09-02',
  version: 1, next_slot_starts_at: '2099-10-12T05:00:00.000Z', total_capacity: 20, total_active: 18, pending_count: 2,
  visible_tag_id: null, visible_tag_name: null,
}

async function render() {
  await act(async () => {
    root.render(<EventsListV8 />)
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  fetchApi.mockReset()
  fetchApi.mockImplementation(async () => ({ items: [event], total: 1, summary: null }))
  listFolders.mockReset()
  listFolders.mockResolvedValue({ success: true, data: [{ id: 'folder-class', kind: 'event', name: '教室', color: '#2f6fde', itemCount: 1 }], unfiledCount: 0 })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  role.value = 'owner'
})

const createLink = () => [...host.querySelectorAll('a')].find((a) => a.textContent?.includes('イベントを作る'))

describe('V8 イベント予約の一覧', () => {
  it('統括には「イベントを作る」を置き、閲覧のみの帯は出さない', async () => {
    role.value = 'owner'
    await render()
    expect(createLink()?.getAttribute('href')).toBe('/events/new')
    expect(host.textContent).not.toContain('閲覧のみで見ています')
  })

  it('見るだけの人には「イベントを作る」を置かず、閲覧のみの帯を出す（2026-10-06 オーナー決定）', async () => {
    role.value = 'staff'
    await render()
    expect(createLink()).toBeUndefined()
    expect(host.textContent).toContain('閲覧のみで見ています')
  })

  it('行の名前の前に、左の列と同じフォルダの丸が付く', async () => {
    await render()
    const dot = host.querySelector('[data-folder-dot]')
    expect(dot?.getAttribute('aria-label')).toBe('フォルダ：教室')
    expect(host.textContent).toContain('秋のしつけ教室')
  })
})
