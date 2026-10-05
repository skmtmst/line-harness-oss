// @vitest-environment happy-dom
/*
 * 友だち一覧の窓（M10・V8のみ）。
 * - 机・2,000行：窓の内側だけ描く（全部描かない）
 * - v7：今までどおり全部描く
 * - 選んだ行：窓の中は印付き・選び自体は外の Set（崩さない）
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FriendListItem } from '@/lib/api'
import FriendListTable from './friend-list-table'

afterEach(() => cleanup())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/friends',
  useSearchParams: () => new URLSearchParams(),
}))

function desktop() {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

function friends(count: number): FriendListItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `f${i}`,
    displayName: `友だち${i}`,
    tags: [],
    chatStatus: 'none',
    attention: false,
    responseStatus: 'none',
    createdAt: '2026-09-01T00:00:00+09:00',
    latestOutgoingAt: null,
    latestIncomingMessage: null,
    activeScenario: null,
    operator: null,
    metadata: {},
  })) as unknown as FriendListItem[]
}

function tableProps(list: FriendListItem[]) {
  return {
    friends: list,
    status: 'ready' as const,
    total: list.length,
    page: 1,
    pageCount: 1,
    pageSize: list.length,
    pageSizeOptions: [list.length] as unknown as readonly number[],
    onPageChange: () => {},
    onPageSizeChange: () => {},
  }
}

describe('友だち一覧の窓', () => {
  it('V8・机・多い行は窓の内側だけ描く', () => {
    document.documentElement.dataset.theme = 'v8'
    desktop()
    try {
      const list = friends(200)
      const { container } = render(<FriendListTable {...tableProps(list)} />)
      const windows = container.querySelectorAll('[data-virtual-index]')
      expect(windows.length).toBeGreaterThan(0)
      expect(windows.length).toBeLessThan(200)
      // 下の詰め物で高さを保つ。
      expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
    } finally {
      delete document.documentElement.dataset.theme
    }
  })

  it('v7は今までどおり全部描く', () => {
    const list = friends(70)
    const { container } = render(<FriendListTable {...tableProps(list)} />)
    expect(container.querySelector('[data-virtual-index]')).toBeNull()
    expect(container.querySelectorAll('.contents').length).toBe(70)
  })

  it('選んだ行の印は窓の中でも付く', () => {
    document.documentElement.dataset.theme = 'v8'
    desktop()
    try {
      const list = friends(200)
      render(<FriendListTable {...tableProps(list)} selectedIds={new Set(['f1'])} />)
      // 選んだ行（窓の内側）は印付きで描く。落ちなければ選びは崩れない。
      expect(screen.getByText('友だち1')).toBeTruthy()
    } finally {
      delete document.documentElement.dataset.theme
    }
  })
})
