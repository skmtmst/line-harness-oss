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
const updateEvent = vi.hoisted(() => vi.fn())
const staffMe = vi.hoisted(() => vi.fn())
const foldersList = vi.hoisted(() => vi.fn())
const foldersCreate = vi.hoisted(() => vi.fn())
const routerPush = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchApi,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: staffMe },
      folders: { ...actual.api.folders, list: foldersList, create: foldersCreate },
    },
    eventsApi: { ...actual.eventsApi, deleteEvent, updateEvent },
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
  updateEvent.mockReset()
  staffMe.mockReset()
  foldersList.mockReset()
  foldersCreate.mockReset()
  routerPush.mockReset()
  updateEvent.mockResolvedValue({ version: 2 })
  foldersCreate.mockResolvedValue({ success: true, data: { id: 'f1', name: '教室' } })
  fetchApi.mockImplementation(async (url: string) => {
    if (url.includes('filter=pending')) return { items: [], total: 0 }
    return listPayload()
  })
  staffMe.mockResolvedValue({ success: true, data: { role: 'owner' } })
  foldersList.mockResolvedValue({ success: true, data: [] })
})

afterEach(async () => {
  vi.useRealTimers()
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

  it('行の名前の前に、左のフォルダの列と同じ色の丸が付く（未分類は輪）', async () => {
    fetchApi.mockImplementation(async (url: string) => {
      if (url.includes('filter=pending')) return { items: [], total: 0 }
      return { ...listPayload(), items: [item({ id: 'e1', folderId: 'ef-class' }), item({ id: 'e2', name: '冬のしつけ教室', folderId: null })], total: 2 }
    })
    foldersList.mockResolvedValue({ success: true, data: [{ id: 'ef-class', kind: 'event', name: '教室', parentId: null, displayOrder: 0, color: '#2f6fde', itemCount: 1 }], unfiledCount: 1 })
    await renderList()
    const filed = document.querySelector('tr[data-row-id="e1"]')?.querySelectorAll('[data-folder-dot]') ?? []
    expect(filed).toHaveLength(1)
    expect(filed[0].getAttribute('data-folder-dot')).toBe('filed')
    expect(filed[0].getAttribute('aria-label')).toBe('フォルダ：教室')
    const unfiled = document.querySelector('tr[data-row-id="e2"]')?.querySelectorAll('[data-folder-dot]') ?? []
    expect(unfiled).toHaveLength(1)
    expect(unfiled[0].getAttribute('data-folder-dot')).toBe('unfiled')
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

  it('読み込み中は骨組みで場所を取り「読み込み中」の文字は出さない', async () => {
    fetchApi.mockImplementation(() => new Promise(() => {}))
    // 待ちは偽の時計で進める（本物の時間を待たない）。骨組みの 0.3 秒は描いた瞬間から数えるので、描く前に替える。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    await renderList()
    expect(document.querySelector('[aria-busy="true"]'), '場所取りがある').toBeTruthy()
    expect(document.body.textContent).toContain('イベントの一覧を読み込んでいます')
    expect(document.body.textContent).not.toContain('読み込み中')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350)
    })
    expect(
      document.querySelectorAll('[data-skeleton]').length,
      '骨組みの行が出る',
    ).toBeGreaterThanOrEqual(5)
  })

  it('V8 の決まり（layer・色直書きなし・準備中なし）を守る', () => {
    expect(v8css.split('\n')[0]).toContain('@layer properties, theme, base, components, utilities;')
    expect(v8css).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(v8css).not.toMatch(/box-shadow\s*:/)
    expect(v8tsx).toContain('data-design-node="e2ekFu"')
    expect(v8tsx).not.toContain('準備中')
  })

  it('行を押すと右の詳細パネルが開き↑↓で次の行へ移る', async () => {
    fetchApi.mockImplementation(async (url: string) => {
      if (url.includes('filter=pending')) return { items: [], total: 0 }
      return { ...listPayload(), items: [item({ id: 'e1' }), item({ id: 'e2', name: '冬の体験会' }) ], total: 2 }
    })
    await renderList()
    const first = document.querySelector<HTMLElement>('button[aria-label="「秋のしつけ教室（第1回）」の詳細を見る"]')
    expect(first, '行名のボタンがある').toBeTruthy()
    await act(async () => { first!.click() })
    await flush()
    const panel = document.querySelector('[data-design-part="detail-panel"]')
    expect(panel, '詳細パネルが開く').toBeTruthy()
    expect(panel?.textContent).toContain('秋のしつけ教室')
    const next = [...panel!.querySelectorAll<HTMLElement>('button')].find((b) => b.getAttribute('aria-label') === '次の行')
    await act(async () => { next!.click() })
    await flush()
    expect(document.querySelector('[data-design-part="detail-panel"]')?.textContent).toContain('冬の体験会')
  })

  it('行を右クリックすると「…」と同じ操作が出る', async () => {
    await renderList()
    const first = document.querySelector<HTMLElement>('button[aria-label="「秋のしつけ教室（第1回）」の詳細を見る"]')
    await act(async () => {
      first!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 120 }))
    })
    await flush()
    const menu = document.body.querySelector('[data-context-menu]')
    expect(menu, '右クリックメニューが出る').toBeTruthy()
    expect(menu?.textContent).toContain('申込者を見る')
    expect(menu?.textContent).toContain('削除する')
  })

  it('詳細パネルの名前をその場で変えると更新口へ届く', async () => {
    await renderList()
    const first = document.querySelector<HTMLElement>('button[aria-label="「秋のしつけ教室（第1回）」の詳細を見る"]')
    await act(async () => { first!.click() })
    await flush()
    const panel = document.querySelector('[data-design-part="detail-panel"]')
    const edit = [...panel!.querySelectorAll<HTMLElement>('button')].find((b) => b.getAttribute('aria-label') === 'イベント名を変更する')
    expect(edit, '名前の変更ボタンがある').toBeTruthy()
    await act(async () => { edit!.click() })
    await flush()
    const input = document.querySelector<HTMLInputElement>('[data-design-part="detail-panel"] input[aria-label="イベント名"]')
    expect(input, '入力欄が出る').toBeTruthy()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input!, '改名した教室')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await flush()
    expect(updateEvent, '更新口へ名前と版が届く').toHaveBeenCalledWith('acc-1', 'e1', { name: '改名した教室' }, 1)
    expect(document.body.textContent).toContain('改名した教室')
  })

  it('フォルダの追加は真ん中の窓ではなく右のパネルで入れる', async () => {
    await renderList()
    const add = [...document.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.includes('フォルダを追加する'))
    expect(add, 'フォルダ追加がある').toBeTruthy()
    await act(async () => { add!.click() })
    await flush()
    const panel = document.querySelector('[data-design-part="detail-panel"]')
    expect(panel, '右のパネルが開く').toBeTruthy()
    expect(panel?.textContent).toContain('フォルダを追加')
    expect(document.querySelector('.fixed.inset-0.z-50'), '真ん中の窓は出ない').toBeNull()
  })
})
