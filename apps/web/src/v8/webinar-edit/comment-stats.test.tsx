// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebinarAnalytics } from '@/lib/api'
import CommentViewerStats from './comment-stats'

const analytics = {
  summary: { reservations: 124, viewers: 103, registeredAndJoined: 88, completed: 71 },
  daily: [],
} as unknown as WebinarAnalytics
afterEach(cleanup)

it('コメントの演出でも申込・完了・途中離脱・未入場の実集計を読む', () => {
  render(<CommentViewerStats analytics={analytics} state="ready" onRetry={() => {}} />)
  for (const value of ['124', '71', '32', '36']) expect(screen.getByText(value)).toBeTruthy()
  expect(screen.getByText('平均離脱時間 —')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).toBeNull()
})

it('読み込み中は以前の集計を出さず、未取得と0人を混同しない', () => {
  const view = render(<CommentViewerStats analytics={analytics} state="loading" onRetry={() => {}} />)
  expect(screen.getAllByText('—')).toHaveLength(4)
  expect(screen.queryByText('124')).toBeNull()
  const zero = { ...analytics, summary: { ...analytics.summary, reservations: 0, viewers: 0, registeredAndJoined: 0, completed: 0 } }
  view.rerender(<CommentViewerStats analytics={zero} state="ready" onRetry={() => {}} />)
  expect(screen.getAllByText('0')).toHaveLength(4)
})

it('集計の取得失敗は理由と再試行を示し、コメントの入力を止めない', () => {
  const retry = vi.fn()
  render(<CommentViewerStats analytics={null} state="error" onRetry={retry} />)
  expect(screen.getAllByText('—')).toHaveLength(4)
  expect(screen.getByText('視聴の集計を読み込めませんでした。コメントの入力は続けられます。')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
  expect(retry).toHaveBeenCalledTimes(1)
})
