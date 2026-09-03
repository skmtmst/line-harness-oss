import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { FriendListItem } from '@/lib/api'
import FriendListRow from './friend-list-row'
import type { FriendListColumn } from './friend-list-table'

/* 画面のコードは行を押すと会話へ飛ぶ。描くだけなので遷移先は使わない。 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}))

/*
  **形は型に照らす。** 別名で書くと、実装が読んでいない鍵を渡したまま
  「出ている」絵が基準になり、何も確かめていないことになる。
*/
const BASE: FriendListItem = {
  id: 'friend-1',
  lineUserId: 'U0000000000000000000000000000001',
  displayName: '田中 はなこ',
  pictureUrl: null,
  statusMessage: null,
  isFollowing: true,
  chatStatus: 'resolved',
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-20T09:00:00.000Z',
  tags: [],
  latestIncomingMessage: null,
  latestOutgoingAt: null,
  activeScenario: null,
  operator: null,
  supportMark: null,
}

const COLUMNS = new Set<FriendListColumn>(['support', 'scenario', 'latest', 'tags', 'last'])

const render = (friend: FriendListItem) =>
  renderToStaticMarkup(
    <FriendListRow friend={friend} visibleColumns={COLUMNS} gridTemplateColumns="36px" />,
  )

describe('友だち行の担当者とアバター（描画）', () => {
  it('担当者がいるときは頭文字の丸アイコンを描く', () => {
    const html = render({ ...BASE, operator: { id: 'op-1', name: '佐藤 けん' } })
    expect(html).toContain('data-operator-avatar="assigned"')
    expect(html).toContain('>佐</span>')
    expect(html).toContain('担当：佐藤 けん')
  })

  it('未割り当ては空欄にせず全角ハイフンで埋める', () => {
    const html = render(BASE)
    expect(html).toContain('data-operator-avatar="unassigned"')
    expect(html).toContain('>－</span>')
    expect(html).toContain('担当：未割り当て')
    /* 空の丸だけが並ぶと「読み込み中で出ていない」と見分けが付かない。 */
    expect(html).not.toContain('data-operator-avatar="unassigned"></span>')
  })

  it('アバターは真円ではなく設計のr=18で描く', () => {
    const withPicture = render({ ...BASE, pictureUrl: 'https://example.test/a.png' })
    expect(withPicture).toContain('rounded-large')
    expect(withPicture).not.toContain('rounded-full bg-avatar-bg')

    const withoutPicture = render(BASE)
    expect(withoutPicture).toContain('rounded-large')
  })
})
