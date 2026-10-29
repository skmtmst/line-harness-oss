// @vitest-environment happy-dom
/*
 * 未選択の中央の「次にやること」（ID27）。
 * - 件数があれば今の状況と［いちばん古い会話を開く］を出す
 * - 全部片づいた時は片づいたと言う（行き先は出さない）
 * - 件数が読めない時は数を出さず今までどおりの案内だけ
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import InboxEmptyGuide from './inbox-empty-guide'

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const base = {
  slaEnabled: true,
  chats: [{ id: 'chat-old', status: 'unread', lastMessageAt: '2026-08-11T00:00:00.000Z' }],
  emails: [],
  onOpenTarget: () => {},
} as const

describe('InboxEmptyGuide', () => {
  test('件数と行き先を出す', () => {
    const onOpenTarget = vi.fn()
    render(<InboxEmptyGuide {...base} unread={1} overdue={3} onOpenTarget={onOpenTarget} />)
    expect(screen.getByText('対応が必要な会話があります')).not.toBeNull()
    expect(screen.getByText('未対応 1 件・期限超過 3 件')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'いちばん古い会話を開く' }))
    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'chat', id: 'chat-old' })
  })

  test('SLA無しは「1時間以上待ち」と言う', () => {
    render(<InboxEmptyGuide {...base} slaEnabled={false} unread={0} overdue={2} />)
    expect(screen.getByText('未対応 0 件・1時間以上待ち 2 件')).not.toBeNull()
  })

  test('片方が0件でもう片方が読めない時は断定しない', () => {
    render(<InboxEmptyGuide {...base} unread={0} overdue={null} />)
    expect(screen.getByText('会話を選ぶと、ここに表示されます')).not.toBeNull()
    expect(screen.queryByText('対応が必要な会話があります')).toBeNull()
  })

  test('全部片づいた時は行き先を出さない', () => {
    render(<InboxEmptyGuide {...base} unread={0} overdue={0} />)
    expect(screen.getByText('対応が必要な会話はありません')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'いちばん古い会話を開く' })).toBeNull()
  })

  test('件数が読めない時は数を出さない', () => {
    render(<InboxEmptyGuide {...base} unread={null} overdue={null} />)
    expect(screen.getByText('会話を選ぶと、ここに表示されます')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'いちばん古い会話を開く' })).toBeNull()
  })

  test('開ける会話が読み込み済みに無い時は行き先を出さない', () => {
    render(<InboxEmptyGuide {...base} chats={[]} unread={1} overdue={0} />)
    expect(screen.getByText('未対応 1 件・期限超過 0 件')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'いちばん古い会話を開く' })).toBeNull()
  })
})
