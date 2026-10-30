// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FriendDetail } from '@/lib/api'
import type { FriendDetailState } from './use-friend-detail'
import type { FriendTimelineItem } from './timeline'
import HistoryTab from './history-tab'

vi.mock('@/components/shared/list-url-state', async () => {
  const { useState } = await import('react')
  return { useListUrlValue: (_key: string, initial: string) => useState(initial) }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
afterEach(cleanup)
const friend = { id: 'f', createdAt: '2026-08-14T00:10:00+09:00', firstTrackedLinkName: '店頭' } as FriendDetail
const item = (id: string, occurredAt: string, type = 'message_received'): FriendTimelineItem => ({ id, occurredAt, type, summary: id, source: null, status: null, lineAccount: null })
const state = (historyItems: FriendTimelineItem[], extra: Partial<FriendDetailState> = {}) => ({ historyItems, historyStatus: 'ready', historyNextCursor: null, historyLoadingMore: false, historyMoreError: false, loadHistory: vi.fn(), ...extra }) as FriendDetailState
const dateRows = (table: HTMLElement) => within(table).getAllByRole('row').filter(row => row.querySelectorAll('[role="cell"]').length === 1)
const summaries = (table: HTMLElement) => within(table).getAllByRole('row').filter(row => row.querySelectorAll('[role="cell"]').length === 5).map(row => row.querySelectorAll('[role="cell"]')[2].textContent)

describe('履歴の日付の区切り', () => {
  it('同じ日が離れて届いても時系列でまとめ、追加記録も同じ区切りの下へ入れる', () => {
    const items = [item('夜', '2026-08-14T21:00:00+09:00'), item('前日', '2026-08-13T12:00:00+09:00'), item('朝', '2026-08-14T00:30:00+09:00')]
    const original = [...items]
    render(<HistoryTab friend={friend} friendId="f" data={state(items)} />)
    const table = screen.getByRole('table')
    expect(dateRows(table).map(row => row.textContent)).toEqual(['8月14日（金）', '8月13日（木）'])
    expect(summaries(table)).toEqual(['夜', '朝', '店頭から追加されました', '前日'])
    expect(items).toEqual(original)
    expect(screen.getByText('3 件')).toBeTruthy()
  })
  it('日本時間の午前0時と同時刻を保ち、年の異なる同じ月日を分ける', () => {
    render(<HistoryTab friend={friend} friendId="f" data={state([
      item('前夜', '2026-08-13T14:59:59Z'), item('同時刻A', '2026-08-13T15:00:00Z'), item('同時刻B', '2026-08-14T00:00:00+09:00'), item('去年', '2025-08-14T09:00:00+09:00'),
    ])} />)
    const table = screen.getByRole('table')
    expect(dateRows(table).length).toBe(3)
    expect(summaries(table)).toEqual(['店頭から追加されました', '同時刻A', '同時刻B', '前夜', '去年'])
  })
  it('続きを待つ間は追加記録を出さず、読めた行と同じ日の続きを一つの区切りへ足す', () => {
    const loadHistory = vi.fn(), first = [item('先頭', '2026-08-14T21:00:00+09:00')]
    const { rerender } = render(<HistoryTab friend={friend} friendId="f" data={state(first, { historyNextCursor: 'next', loadHistory })} />)
    expect(screen.queryByText('友だち追加')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }))
    expect(loadHistory).toHaveBeenCalledWith('next')
    rerender(<HistoryTab friend={friend} friendId="f" data={state([...first, item('続き', '2026-08-14T00:30:00+09:00')])} />)
    expect(dateRows(screen.getByRole('table')).length).toBe(1)
    expect(summaries(screen.getByRole('table'))).toEqual(['先頭', '続き', '店頭から追加されました'])
  })
  it('種類の切り替えで日付の空見出しを残さず、受信と送信には追加記録を混ぜない', () => {
    render(<HistoryTab friend={friend} friendId="f" data={state([item('受信記録', '2026-08-14T21:00:00+09:00'), item('送信記録', '2026-08-13T21:00:00+09:00', 'message_sent'), item('システム記録', '2026-08-14T20:00:00+09:00', 'tag_change')])} />)
    fireEvent.click(screen.getByRole('button', { name: '受信' }))
    expect(summaries(screen.getByRole('table'))).toEqual(['受信記録'])
    expect(dateRows(screen.getByRole('table')).length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    expect(summaries(screen.getByRole('table'))).toEqual(['送信記録'])
    fireEvent.click(screen.getByRole('button', { name: 'システム通知' }))
    expect(summaries(screen.getByRole('table'))).toEqual(['システム記録', '店頭から追加されました'])
    expect(dateRows(screen.getByRole('table')).length).toBe(1)
  })
  it('活動が空でも追加記録を一つだけ保ち、取得中と失敗では作り物の日付を出さない', () => {
    const { rerender } = render(<HistoryTab friend={friend} friendId="f" data={state([])} />)
    expect(dateRows(screen.getByRole('table')).length).toBe(1)
    expect(screen.getByText('友だち追加')).toBeTruthy()
    for (const historyStatus of ['loading', 'error'] as const) {
      rerender(<HistoryTab friend={friend} friendId="f" data={state([], { historyStatus })} />)
      expect(screen.queryByText('友だち追加')).toBeNull()
      expect(dateRows(screen.getByRole('table')).length).toBe(0)
    }
  })
})
