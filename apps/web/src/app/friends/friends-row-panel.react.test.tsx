// @vitest-environment happy-dom
/*
 * 友だち一覧V8の行パネル（サクサク感 C・D・E）。
 * 行を押すと右に詳しい内容（一覧は左のまま・次の行へ移れる）。
 * 右クリックでも行と同じ品ぞろえ。詳しい画面へは移り変わりで進む。
 * v7 は行を押すとそのまま詳細へ行く（変えない）。
 */
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FriendListItem } from '@/lib/api'

const pushes: string[] = []

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (url: string) => { pushes.push(url) }, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/friends',
}))

import FriendListTable from '@/components/friends/friend-list-table'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

const friend = (id: string, displayName: string): FriendListItem => ({
  id,
  lineUserId: `U-${id}`,
  displayName,
  pictureUrl: null,
  statusMessage: null,
  isFollowing: true,
  metadata: {},
  createdAt: '2026-09-01T00:00:00+09:00',
  updatedAt: '2026-09-02T00:00:00+09:00',
  chatStatus: 'unread',
  tags: [],
})

const tableProps = {
  status: 'ready' as const,
  page: 1,
  pageCount: 1,
  pageSize: 20,
  pageSizeOptions: [20] as readonly number[],
  onPageChange: () => {},
  onPageSizeChange: () => {},
}

beforeEach(() => {
  pushes.length = 0
  vi.clearAllMocks()
  document.documentElement.dataset.theme = 'v8'
})

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.theme
})

describe('友だち一覧V8の行パネル（C・D・E）', () => {
  it('行を押すと詳しい内容が開き、次の行へ移れる', async () => {
    render(
      <FriendListTable
        {...tableProps}
        friends={[friend('f1', '田中花子'), friend('f2', '佐藤次郎')]}
        onToggleAttention={() => {}}
      />,
    )
    await flush()
    fireEvent.click(screen.getByRole('link', { name: '田中花子の詳しい内容を見る' }))
    await flush()
    const panel = document.body.querySelector('[data-design-part="detail-panel"]')
    expect(panel?.textContent).toContain('田中花子')
    fireEvent.click(screen.getByRole('button', { name: '次の行' }))
    await flush()
    expect(document.body.querySelector('[data-design-part="detail-panel"]')?.textContent).toContain('佐藤次郎')
  })

  it('パネルの「詳細を開く」は友だち詳細へ進む', async () => {
    render(
      <FriendListTable
        {...tableProps}
        friends={[friend('f1', '田中花子')]}
        onToggleAttention={() => {}}
      />,
    )
    await flush()
    fireEvent.click(screen.getByRole('link', { name: '田中花子の詳しい内容を見る' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '詳細を開く' }))
    await flush()
    expect(pushes).toContain('/friends/detail?id=f1')
  })

  it('右クリックでも行と同じ品ぞろえが出る', async () => {
    render(
      <FriendListTable
        {...tableProps}
        friends={[friend('f1', '田中花子')]}
        onToggleAttention={() => {}}
      />,
    )
    await flush()
    fireEvent.contextMenu(screen.getByRole('link', { name: '田中花子の詳しい内容を見る' }))
    await flush()
    expect(screen.getByRole('menuitem', { name: '詳細を開く' }), '詳細を開くがある').toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '受信箱で開く' }), '受信箱で開くがある').toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '注目を付ける' }), '注目を付けるがある').toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '受信箱で開く' }))
    await flush()
    expect(pushes).toContain('/chats?friend=f1')
  })

  it('v7 は行を押すとそのまま詳細へ行く', async () => {
    delete document.documentElement.dataset.theme
    render(
      <FriendListTable
        {...tableProps}
        friends={[friend('f1', '田中花子')]}
        onToggleAttention={() => {}}
      />,
    )
    await flush()
    fireEvent.click(screen.getByRole('link', { name: '田中花子の詳細を開く' }))
    await flush()
    expect(pushes).toContain('/friends/detail?id=f1')
    expect(document.body.querySelector('[data-design-part="detail-panel"]')).toBeNull()
  })
})
