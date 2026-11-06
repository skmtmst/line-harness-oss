// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fx = vi.hoisted(() => ({ account: 'A', period: 'today', overview: vi.fn() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(`period=${fx.period}`) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fx.account, selectedAccount: null, loading: false }) }))
vi.mock('@/lib/staff-role', () => ({ useStaffIdentity: () => null }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => false }) }))
vi.mock('@/lib/use-same-page-url', () => ({ useSamePageUrl: () => ({ replace: vi.fn() }) }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, dashboard: { ...actual.api.dashboard, overview: fx.overview, preferences: { get: async () => ({ success: false }) } } } }
})
import { useDashboard } from './use-dashboard'
const overview = (active: number) => ({ success: true, data: { friends: { active }, inbox: { unanswered: 0 }, delivery: {}, conversions: {}, trend: [] } })
function deferred() {
  let resolve!: (value: ReturnType<typeof overview>) => void
  const promise = new Promise<ReturnType<typeof overview>>(yes => { resolve = yes })
  return { promise, resolve }
}
beforeEach(() => {
  fx.account = 'A'; fx.period = 'today'; fx.overview.mockReset().mockResolvedValue(overview(10))
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: false }), { headers: { 'Content-Type': 'application/json' } }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })
it('期間変更中は前の数字と期間を残し、更新中を明記して成功後に切り替える', async () => {
  const view = renderHook(() => useDashboard())
  await waitFor(() => expect(view.result.current.activeFriends).toBe(10))
  const next = deferred(); fx.overview.mockReturnValueOnce(next.promise)
  fx.period = 'last7'; view.rerender()
  await waitFor(() => expect(view.result.current.period).toBe('last7'))
  expect(view.result.current.activeFriends).toBe(10)
  expect(view.result.current.displayedPeriod).toBe('today')
  expect(view.result.current.periodNotice).toBe('前の期間を表示・更新中')
  expect(view.result.current.loading).toBe(false)
  await act(async () => next.resolve(overview(70)))
  expect(view.result.current.activeFriends).toBe(70)
  expect(view.result.current.displayedPeriod).toBe('last7')
  expect(view.result.current.periodNotice).toBe('')
})
it('期間取得の失敗時も旧期間であることを明記し、もう一度取得できる', async () => {
  const view = renderHook(() => useDashboard())
  await waitFor(() => expect(view.result.current.activeFriends).toBe(10))
  fx.overview.mockRejectedValueOnce(new Error('通信断'))
  fx.period = 'last7'; view.rerender()
  await waitFor(() => expect(view.result.current.error).not.toBe(''))
  expect(view.result.current.activeFriends).toBe(10)
  expect(view.result.current.periodNotice).toContain('前の期間を表示しています')
  fx.overview.mockResolvedValueOnce(overview(70))
  await act(async () => view.result.current.load())
  expect(view.result.current.activeFriends).toBe(70)
  expect(view.result.current.periodNotice).toBe('')
})
it('アカウントを替えた描画では旧数字を消し、遅い旧アカウントの答えも捨てる', async () => {
  const view = renderHook(() => useDashboard())
  await waitFor(() => expect(view.result.current.activeFriends).toBe(10))
  const old = deferred(); fx.overview.mockReturnValueOnce(old.promise)
  fx.period = 'last7'; view.rerender()
  await waitFor(() => expect(fx.overview).toHaveBeenCalledTimes(2))
  const next = deferred(); fx.overview.mockReturnValueOnce(next.promise)
  fx.account = 'B'; view.rerender()
  expect(view.result.current.data).toBeNull()
  expect(view.result.current.periodNotice).toBe('')
  await act(async () => old.resolve(overview(999)))
  expect(view.result.current.data).toBeNull()
  await act(async () => next.resolve(overview(20)))
  expect(view.result.current.activeFriends).toBe(20)
})
