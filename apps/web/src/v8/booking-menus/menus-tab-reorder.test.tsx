// @vitest-environment happy-dom
/*
 * 予約メニュー一覧の並び替え（オーナー点検 2026-10-08）。
 *
 * 直す前: つまみと「つかめる」カーソルは出ていたが、ドラッグの処理が無く、
 * 上下キーと「…」の上へ／下へでしか動かせなかった。検索中も「…」の上へ／下へが出て、
 * 絞った並びの番号と全体の並びの番号がずれていた。
 *
 * 決まり: ドラッグ・上下キー・「…」の上へ／下へは同じ結果。検索中・閲覧のみは
 * つまみを出さず理由を言う。保存に失敗したら元の位置へ戻して理由を出す。
 */
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookingMenu } from '@/lib/api'

const updateMenu = vi.hoisted(() => vi.fn())
const toasts = vi.hoisted(() => [] as string[])

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return { ...actual, bookingApi: { ...actual.bookingApi, updateMenu } }
})
vi.mock('@/components/shared/toast', () => ({ notifyToast: (message: string) => { toasts.push(message) } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
}))
vi.mock('../menu-version-history', () => ({ default: () => null }))

import { MenusTabV8 } from './tabs/menus-tab'

type ServerMenu = { id: string; name: string; sort_order: number; version: number }
let server: ServerMenu[] = []
let failOnCall = 0
let calls = 0

function toMenu(row: ServerMenu): BookingMenu {
  return {
    id: row.id, name: row.name, sort_order: row.sort_order, version: row.version,
    duration_minutes: 30, is_active: 1, description: null, category_label: null,
    assigned_staff: [], booking_count_30_days: 0,
  } as unknown as BookingMenu
}

function Harness({ canEdit = true }: { canEdit?: boolean }) {
  const [menus, setMenus] = useState(() => server.map(toMenu))
  return (
    <MenusTabV8
      accountId="account-a"
      menus={menus}
      status="ready"
      error={null}
      menuCount={menus.length}
      canEdit={canEdit}
      onReload={() => setMenus(server.map(toMenu))}
    />
  )
}

beforeEach(() => {
  server = [
    { id: 'a', name: 'カット', sort_order: 10, version: 1 },
    { id: 'b', name: 'カラー', sort_order: 20, version: 1 },
    { id: 'c', name: 'パーマ', sort_order: 30, version: 1 },
  ]
  failOnCall = 0
  calls = 0
  toasts.length = 0
  updateMenu.mockReset()
  updateMenu.mockImplementation(async (_account: string, id: string, version: number, body: Partial<BookingMenu>) => {
    calls += 1
    if (failOnCall && calls === failOnCall) throw new Error('network')
    const row = server.find((item) => item.id === id)!
    if (row.version !== version) throw new Error('conflict')
    row.sort_order = body.sort_order as number
    row.version += 1
    return { ok: true, version: row.version }
  })
})
afterEach(cleanup)

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}

function shownNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-reorder-id]')].map((row) => row.dataset.reorderId ?? '')
}

function serverOrder(): string[] {
  return [...server].sort((x, y) => x.sort_order - y.sort_order).map((row) => row.id)
}

function handleOf(name: string) {
  return screen.getByRole('button', { name: `「${name}」を並び替える（ドラッグ・↑↓キー）` })
}

async function moveBy(how: 'drag' | 'key' | 'menu', container: HTMLElement) {
  if (how === 'key') {
    fireEvent.keyDown(handleOf('カット'), { key: 'ArrowDown' })
  } else if (how === 'menu') {
    fireEvent.click(screen.getByRole('button', { name: '「カット」のそのほかの操作' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /^下へ/ }))
  } else {
    const target = container.querySelector<HTMLElement>('[data-reorder-id="b"]')!
    fireEvent.dragStart(handleOf('カット'))
    fireEvent.dragEnter(target)
    fireEvent.dragOver(target)
    fireEvent.drop(target)
  }
  await flush()
}

describe('予約メニューの並び替え', () => {
  it('ドラッグ・上下キー・「…」の下へは同じ結果になり、読み直しても残る', async () => {
    const results: string[][] = []
    for (const how of ['drag', 'key', 'menu'] as const) {
      cleanup()
      server.forEach((row, index) => { row.sort_order = (index + 1) * 10 })
      server.sort((x, y) => x.sort_order - y.sort_order)
      const { container } = render(<Harness />)
      expect(shownNames(container)).toEqual(['a', 'b', 'c'])
      await moveBy(how, container)
      expect(serverOrder(), how).toEqual(['b', 'a', 'c'])
      results.push(shownNames(container))
    }
    expect(results).toEqual([['b', 'a', 'c'], ['b', 'a', 'c'], ['b', 'a', 'c']])
  })

  it('ドラッグで2つ以上離れた位置へも動かせる', async () => {
    const { container } = render(<Harness />)
    const target = container.querySelector<HTMLElement>('[data-reorder-id="c"]')!
    fireEvent.dragStart(handleOf('カット'))
    fireEvent.dragEnter(target)
    fireEvent.dragOver(target)
    fireEvent.drop(target)
    await flush()
    expect(serverOrder()).toEqual(['b', 'c', 'a'])
    expect(shownNames(container)).toEqual(['b', 'c', 'a'])
  })

  it('検索中・閲覧のみはつまみを出さず、「…」にも上へ・下へを出さない', async () => {
    const { container, unmount } = render(<Harness />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'メニュー名で探す' }), { target: { value: 'カ' } })
    expect(container.querySelector('[data-reorder-handle]')).toBeNull()
    expect(container.querySelector('[data-reorder-disabled]')?.getAttribute('title')).toBe('検索を外すと動かせます')
    fireEvent.click(screen.getByRole('button', { name: '「カット」のそのほかの操作' }))
    const labels = within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent)
    expect(labels.some((label) => label?.startsWith('上へ') || label?.startsWith('下へ'))).toBe(false)
    unmount()
    const viewer = render(<Harness canEdit={false} />)
    expect(viewer.container.querySelector('[data-reorder-handle]')).toBeNull()
    expect(viewer.container.querySelector('[data-reorder-disabled]')?.getAttribute('title')).toBe('閲覧のみのため並び替えできません')
  })

  it('保存の途中で失敗したら、書き換えた分を戻して元の位置で理由を出す', async () => {
    failOnCall = 2
    const { container } = render(<Harness />)
    fireEvent.keyDown(handleOf('カット'), { key: 'ArrowDown' })
    await flush()
    expect(server.map((row) => [row.id, row.sort_order])).toEqual([['a', 10], ['b', 20], ['c', 30]])
    expect(shownNames(container)).toEqual(['a', 'b', 'c'])
    expect(toasts.at(-1)).toContain('予約メニューを保存できませんでした')
  })
})

describe('並べ替えが途中で失敗し、戻しもできなかったとき（WEB052）', () => {
  it('「一部だけが変わりました」と知らせる', async () => {
    // 1件目（カット→20）は通り、2件目で失敗、戻す（カット→10）も失敗する。
    updateMenu.mockImplementation(async (_account: string, id: string, version: number, body: Partial<BookingMenu>) => {
      calls += 1
      if (calls >= 2) throw new Error('network')
      const row = server.find((item) => item.id === id)!
      row.sort_order = body.sort_order as number
      row.version = version + 1
      return { ok: true, version: row.version }
    })
    const { container } = render(<Harness />)
    await moveBy('key', container)
    expect(toasts.at(-1)).toContain('一部だけが変わりました')
  })
})
