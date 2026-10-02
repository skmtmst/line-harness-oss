// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FriendListItem } from '@/lib/api'
import type { FriendListColumn } from './friend-list-table'

/*
 * R112: 最終接触日は幅で変わらない。表の行と狭い画面のカードは
 * 同じ相手に同じ日を出す。受信より後に返信したときは返信日になる。
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
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

import FriendListRow, { FriendListCard, selectLastContactAt } from './friend-list-row'

const YEAR = new Date().getFullYear()
const INCOMING = `${YEAR}-08-13T10:00:00.000Z`
const OUTGOING = `${YEAR}-09-26T10:00:00.000Z`

const FRIEND: FriendListItem = {
  id: 'friend-1',
  lineUserId: 'U0000000000000000000000000000001',
  displayName: '山田',
  pictureUrl: null,
  statusMessage: null,
  isFollowing: true,
  chatStatus: 'resolved',
  createdAt: `${YEAR}-01-05T09:00:00.000Z`,
  updatedAt: `${YEAR}-09-26T09:00:00.000Z`,
  tags: [],
  latestIncomingMessage: { content: 'こんにちは', messageType: 'text', createdAt: INCOMING },
  latestOutgoingAt: OUTGOING,
  activeScenario: null,
  operator: null,
  supportMark: null,
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
})

describe('最終接触日は行とカードで同じ', () => {
  it('受信・送信の新しい方を選ぶ', () => {
    expect(selectLastContactAt(FRIEND)).toBe(OUTGOING)
    expect(selectLastContactAt({ ...FRIEND, latestOutgoingAt: null })).toBe(INCOMING)
    expect(selectLastContactAt({ ...FRIEND, latestIncomingMessage: null })).toBe(OUTGOING)
    expect(selectLastContactAt({ ...FRIEND, latestIncomingMessage: null, latestOutgoingAt: null }).slice(0, 10))
      .toBe(`${YEAR}-01-05`)
  })

  it('受信より新しい返信があるとき、行もカードも返信日を出す', () => {
    act(() => {
      root.render(
        <div>
          <FriendListRow
            friend={FRIEND}
            visibleColumns={new Set<FriendListColumn>(['last'])}
            onToggleSelect={() => {}}
            onToggleAttention={() => {}}
          />
          <FriendListCard
            friend={FRIEND}
            visibleColumns={new Set<FriendListColumn>(['last'])}
            onToggleSelect={() => {}}
            onToggleAttention={() => {}}
          />
        </div>,
      )
    })
    const text = host.textContent ?? ''
    expect(text).toContain('9月26日')
    expect(text).not.toContain('8月13日')
  })
})
