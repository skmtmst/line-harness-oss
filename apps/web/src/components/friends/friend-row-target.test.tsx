// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FriendListItem } from '@/lib/api'
import type { FriendListColumn } from './friend-list-table'

/*
 * 行を押した先は友だちの詳細（/friends/detail?id=…）。
 * 受信箱へは最新メッセージの列の明示のリンクからのみ行く。
 * チェックボックス・★では移動しない。実際に押して確かめる。
 */

const pushes: string[] = []
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (url: string) => { pushes.push(url) } }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children?: unknown; onClick?: (event: { stopPropagation: () => void }) => void }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault()
        onClick?.(event)
      }}
      {...(rest as object)}
    >
      {children as never}
    </a>
  ),
}))

import FriendListRow from './friend-list-row'

const BASE: FriendListItem = {
  id: 'friend-1',
  lineUserId: 'U0000000000000000000000000000001',
  displayName: 'Kenta Kawano(Obama)',
  pictureUrl: null,
  statusMessage: null,
  isFollowing: true,
  chatStatus: 'resolved',
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-20T09:00:00.000Z',
  tags: [],
  latestIncomingMessage: {
    content: 'こんにちは',
    messageType: 'text',
    createdAt: '2026-09-20T10:00:00.000Z',
  },
  latestOutgoingAt: null,
  activeScenario: null,
  operator: null,
  supportMark: null,
}

const COLUMNS = new Set<FriendListColumn>(['support', 'scenario', 'latest', 'tags', 'source', 'last'])

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  pushes.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
})

function render(friend: FriendListItem = BASE) {
  act(() => {
    root.render(
      <FriendListRow
        friend={friend}
        visibleColumns={COLUMNS}
        gridTemplateColumns="36px"
        onToggleSelect={() => {}}
        onToggleAttention={() => {}}
      />,
    )
  })
}

function rowElement(): HTMLElement {
  const row = host.querySelector('[role="link"]')
  if (!row) throw new Error('行が見つかりません')
  return row as HTMLElement
}

describe('友だち行の行き先', () => {
  it('行を押すと友だちの詳細へ行く（受信箱ではない）', () => {
    render()
    act(() => {
      rowElement().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(pushes).toEqual(['/friends/detail?id=friend-1'])
  })

  it('Enterでも友だちの詳細へ行く', () => {
    render()
    act(() => {
      rowElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(pushes).toEqual(['/friends/detail?id=friend-1'])
  })

  it('最新メッセージの列のリンクは受信箱を指す', () => {
    render()
    const inbox = host.querySelector('a[aria-label="Kenta Kawano(Obama)さんの会話を受信箱で開く"]')
    expect(inbox).not.toBeNull()
    expect(inbox?.getAttribute('href')).toBe('/chats?friend=friend-1')
  })

  it('受信箱のリンクを押しても行の移動は起きない', () => {
    render()
    const inbox = host.querySelector('a[aria-label="Kenta Kawano(Obama)さんの会話を受信箱で開く"]')
    if (!inbox) throw new Error('受信箱リンクが見つかりません')
    act(() => {
      inbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(pushes).toEqual([])
  })

  it('チェックボックスを押しても移動しない', () => {
    render()
    const checkbox = host.querySelector('input[type="checkbox"]')
    if (!checkbox) throw new Error('チェックボックスが見つかりません')
    act(() => {
      checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(pushes).toEqual([])
  })

  it('名前は列の中で1行省略し、全文はtitleで読める', () => {
    render()
    const name = host.querySelector('a[title="Kenta Kawano(Obama)"]')
    expect(name).not.toBeNull()
    expect(name?.className).toContain('truncate')
  })
})
