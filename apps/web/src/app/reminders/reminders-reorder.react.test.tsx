// @vitest-environment happy-dom
/*
 * リマインダ一覧の並び替え（オーナー点検 2026-10-08）。
 *
 * 直す前: 既定の「次の送信が近い順」でもつまみが出て、ドラッグ・上下キーで動かせた。
 * 保存はその時の並び（次の送信順）に 0 から番号を振り直すため、読み直すと
 * 次の送信順に戻り、「自分で並べた順」も次の送信順で上書きされていた。
 *
 * 決まり（リッチメニュー・自動応答と同じ）: 動かせるのは「自分で並べた順」で、
 * 絞り込みが無く、全件が1ページにあるときだけ。それ以外はつまみを出さず理由を言う。
 * ドラッグ・上下キー・「…」の上へ／下へは同じ結果。保存に失敗したら元の位置へ戻す。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchApi = vi.hoisted(() => vi.fn())
const toasts = vi.hoisted(() => [] as string[])

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  /* api.reminders.reorder は中で元の fetchApi を呼ぶので、同じ口へ向け直す。 */
  const reminders = {
    ...actual.api.reminders,
    reorder: (ids: string[]) => fetchApi('/api/reminders/reorder', { method: 'PATCH', body: JSON.stringify({ ids }) }),
  }
  return { ...actual, fetchApi, api: { ...actual.api, reminders } }
})

/* 5秒の「元に戻す」待ちは部品の試験が持つ。ここでは同じ約束（成功で onCommitted・失敗で戻す）ですぐ流す。 */
vi.mock('@/lib/undoable', async (importOriginal: () => Promise<typeof import('@/lib/undoable')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    runUndoable: (options: {
      commit: () => Promise<unknown>
      undo: () => void
      onCommitError?: () => void
      onCommitted?: () => void
      failureMessage?: string
    }) => {
      void Promise.resolve()
        .then(() => options.commit())
        .then(() => options.onCommitted?.())
        .catch(() => {
          ;(options.onCommitError ?? options.undo)()
          toasts.push(options.failureMessage ?? '')
        })
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

let search = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(search),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

let role = 'owner'
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role }
})

vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, value, onChange, options }: {
    'aria-label'?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))

vi.mock('@/components/shared/list-kpis', () => ({
  default: () => null,
}))

import RemindersPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
/* サーバーの「自分で並べた順」。reorder で書き換わり、sort=order の一覧はこの順で返る。 */
let serverOrder: string[] = []
let reorderCalls: string[][] = []
let failReorder = false
let totalOverride: number | null = null

const NAMES: Record<string, string> = { a: 'Aのお知らせ', b: 'Bのお知らせ', c: 'Cのお知らせ' }
/* 次の送信が近い順は、自分で並べた順と逆。 */
const NEXT_ORDER = ['c', 'b', 'a']

function reminder(id: string) {
  return {
    id, name: NAMES[id], description: null, isActive: true, folderId: null,
    lifecycleStatus: 'published', stepCount: 1, displayOrder: serverOrder.indexOf(id),
    plannedDeliveries: null, lastSentAt: null,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

beforeEach(() => {
  search = ''
  role = 'owner'
  serverOrder = ['a', 'b', 'c']
  reorderCalls = []
  failReorder = false
  totalOverride = null
  toasts.length = 0
  fetchApi.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url.startsWith('/api/folders')) return { success: true, data: [], unfiledCount: 0 }
    if (url === '/api/reminders/reorder') {
      const ids = (JSON.parse(init?.body ?? '{}') as { ids: string[] }).ids
      reorderCalls.push(ids)
      if (failReorder) return { success: false, error: 'boom' }
      // 渡された行に 0 から番号を振り直す（packages/db の reorderReminders と同じ）。
      serverOrder = [...ids, ...serverOrder.filter((id) => !ids.includes(id))]
      return { success: true, data: { updated: ids.length } }
    }
    if (url.startsWith('/api/reminders?')) {
      const params = new URLSearchParams(url.slice(url.indexOf('?') + 1))
      const sort = params.get('sort')
      const ids = sort === 'next' ? NEXT_ORDER : serverOrder
      const q = params.get('q')
      const items = ids.map(reminder).filter((row) => !q || row.name.includes(q))
      return { success: true, data: { items, total: totalOverride ?? items.length, limit: 20, sort: [] } }
    }
    return { success: true, data: {} }
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

function rowOrder(): string[] {
  return [...host.querySelectorAll<HTMLElement>('tr[data-reorder-id]')].map((row) => row.dataset.reorderId ?? '')
}

function handles() {
  return [...host.querySelectorAll<HTMLButtonElement>('button[data-reorder-handle]')]
}

async function mount(query = '') {
  search = query
  window.history.replaceState(null, '', `/reminders${query ? `?${query}` : ''}`)
  await act(async () => { root.render(<RemindersPage />) })
  await flush()
}

function key(target: HTMLElement, keyName: string) {
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true })) })
}

function drag(fromId: string, toId: string) {
  const cell = host.querySelector<HTMLElement>(`tr[data-reorder-id="${fromId}"] td[draggable="true"]`)
  expect(cell, `${fromId} の行をつかめません`).toBeTruthy()
  const target = () => host.querySelector<HTMLElement>(`tr[data-reorder-id="${toId}"]`)!
  act(() => { cell!.dispatchEvent(new Event('dragstart', { bubbles: true })) })
  act(() => { target().dispatchEvent(new Event('dragenter', { bubbles: true })) })
  act(() => { target().dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true })) })
  act(() => { target().dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })) })
}

function menuSelect(id: string, label: string) {
  const more = host.querySelector<HTMLButtonElement>(`button[aria-label="リマインダ「${NAMES[id]}」の操作"]`)
  expect(more).toBeTruthy()
  act(() => { more!.click() })
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((el) => el.textContent?.trim() === label)
  expect(item, `「…」に「${label}」がありません`).toBeTruthy()
  act(() => { item!.click() })
}

describe('リマインダ一覧の並び替え', () => {
  it('次の送信が近い順（既定）では、つまみを出さず理由を言う', async () => {
    await mount()
    expect(rowOrder()).toEqual(['c', 'b', 'a'])
    expect(handles()).toHaveLength(0)
    expect(host.querySelector('td[draggable="true"]')).toBeNull()
    const disabled = host.querySelector<HTMLElement>('[data-reorder-disabled]')
    expect(disabled?.getAttribute('title')).toBe('並びを「自分で並べた順」にすると動かせます')
    expect(disabled?.textContent).toContain('並びを「自分で並べた順」にすると動かせます')
    // 上下キーを押しても保存しない（直す前はここで次の送信順のまま保存していた）。
    const cell = host.querySelector<HTMLElement>('tr[data-reorder-id="c"] td')!
    key(cell, 'ArrowDown')
    await flush()
    expect(reorderCalls).toEqual([])
  })

  it('検索中・閲覧のみでも、つまみを出さない', async () => {
    await mount('sort=order&q=A')
    expect(handles()).toHaveLength(0)
    expect(host.querySelector('[data-reorder-disabled]')?.getAttribute('title')).toBe('絞り込みを外すと動かせます')
    act(() => root.unmount())
    root = createRoot(host)
    role = 'staff'
    await mount('sort=order')
    expect(handles()).toHaveLength(0)
    expect(host.querySelector('[data-reorder-disabled]')?.getAttribute('title')).toBe('閲覧のみのため並び替えできません')
  })

  it('2ページ以上あるときは動かさない（ページの一部だけ番号を振り直さない）', async () => {
    totalOverride = 30
    await mount('sort=order')
    expect(handles()).toHaveLength(0)
    expect(host.querySelector('[data-reorder-disabled]')?.getAttribute('title')).toBe('全件が1ページに収まる表示件数にすると動かせます')
  })

  it('上下キーで動かした順は、読み直しても残る', async () => {
    await mount('sort=order')
    expect(rowOrder()).toEqual(['a', 'b', 'c'])
    expect(handles()).toHaveLength(3)
    key(handles()[0], 'ArrowDown')
    await flush()
    expect(reorderCalls).toEqual([['b', 'a', 'c']])
    expect(rowOrder()).toEqual(['b', 'a', 'c'])
    // 画面を作り直して読み直しても、並べた順のまま。
    act(() => root.unmount())
    root = createRoot(host)
    await mount('sort=order')
    expect(rowOrder()).toEqual(['b', 'a', 'c'])
  })

  it('ドラッグ・上下キー・「…」の下へは同じ結果になる', async () => {
    const results: string[][] = []
    for (const how of ['drag', 'key', 'menu'] as const) {
      serverOrder = ['a', 'b', 'c']
      reorderCalls = []
      act(() => root.unmount())
      root = createRoot(host)
      await mount('sort=order')
      if (how === 'drag') drag('a', 'b')
      if (how === 'key') key(handles()[0], 'ArrowDown')
      if (how === 'menu') menuSelect('a', '下へ')
      await flush()
      expect(reorderCalls, how).toHaveLength(1)
      results.push(rowOrder())
    }
    expect(results).toEqual([['b', 'a', 'c'], ['b', 'a', 'c'], ['b', 'a', 'c']])
  })

  it('次の送信順では「…」に上へ・下へを出さない', async () => {
    await mount()
    const more = host.querySelector<HTMLButtonElement>(`button[aria-label="リマインダ「${NAMES.a}」の操作"]`)!
    act(() => { more.click() })
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim())
    expect(labels).not.toContain('上へ')
    expect(labels).not.toContain('下へ')
  })

  it('保存に失敗したら元の位置へ戻し、理由を出す', async () => {
    failReorder = true
    await mount('sort=order')
    key(handles()[0], 'ArrowDown')
    await flush()
    expect(reorderCalls).toHaveLength(1)
    expect(rowOrder()).toEqual(['a', 'b', 'c'])
    expect(toasts).toEqual(['並び替えを保存できませんでした。'])
  })
})
