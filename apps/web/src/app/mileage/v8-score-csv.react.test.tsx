// @vitest-environment happy-dom
/*
 * V8 行動スコア：この頁のCSV書き出しボタンがある（v7 parity-D）。
 * 押すと表と同じ6列のCSVを取り出す。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import V8ScoreTab from './v8-score-tab'

const calls = vi.hoisted(() => ({ friends: vi.fn(), rules: vi.fn() }))
vi.mock('@/lib/api', () => ({
  api: { actionScores: { friends: calls.friends, rules: calls.rules } },
  ApiError: class extends Error { status?: number },
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/mileage',
}))

const overview = {
  summary: { scoredFriends: 1, high: 1, normal: 0, low: 0, decreased30d: 0, highMin: 80, normalMin: 50 },
  items: [
    {
      friendId: 'f1', displayName: '山田', pictureUrl: null,
      currentScore: 90, band: 'high', change30d: 5,
      lastReason: 'purchase', lastChangedAt: '2026-09-01T00:00:00+09:00',
    },
  ],
  pagination: { total: 1, limit: 20, offset: 0 },
}

afterEach(cleanup)

describe('V8 行動スコアのCSV書き出し', () => {
  it('表と同じ6列のCSVを取り出す', async () => {
    calls.friends.mockResolvedValue({ success: true, data: overview })
    calls.rules.mockResolvedValue({ success: true, data: { rules: [] } })
    const created: { name: string; content: string }[] = []
    const anchorClick = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        void (blob as Blob).text().then((text) => created.push({ name: 'csv', content: text }))
        return 'blob:csv'
      }),
      revokeObjectURL: vi.fn(),
    })
    const createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
      const element = createElement(tag, options)
      if (tag === 'a') element.click = anchorClick
      return element
    }) as typeof document.createElement)
    render(<V8ScoreTab readonly registerHeaderActions={() => {}} />)
    await waitFor(() => expect(screen.getByText('山田')).toBeTruthy())
    const button = screen.getByRole('button', { name: 'この頁の行動スコアをCSVで書き出す' })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    expect(anchorClick).toHaveBeenCalledOnce()
    await waitFor(() => expect(created.length).toBe(1))
    expect(created[0].content.split('\n')[0]).toContain('友だち')
    expect(created[0].content).toContain('山田')
    vi.unstubAllGlobals()
  })
})
