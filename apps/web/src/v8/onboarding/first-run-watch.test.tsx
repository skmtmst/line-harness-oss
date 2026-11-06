// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ progress: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { gettingStarted: { get: net.progress } } }))
import { accountStyleUpdated } from '@/hooks/use-account-style'
import { FIRST_RUN_WATCH_INTERVAL_MS, FIRST_RUN_WATCH_LIMIT_MS, useFirstRun } from './use-first-run'

const KEYS = ['accounts', 'featureSet', 'attributes', 'friendAdd', 'scenario', 'firstMessage'] as const
const reply = (firstMessage: 'todo' | 'done') => ({ success: true, data: {
  steps: KEYS.map((key) => ({ key, state: key === 'firstMessage' ? firstMessage : 'done', href: '/', reason: null })),
  firstRun: { startedAt: '2026-10-26T09:00:00+09:00', styleAt: null, starterAt: null, followAt: null, firstMessageAt: null, minutes: 8 },
} })
let visibility: DocumentVisibilityState = 'visible'
const setVisibility = (next: DocumentVisibilityState) => {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  net.progress.mockReset().mockResolvedValue(reply('todo'))
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('はじめにやることの自動の読み直し', () => {
  it('待っている間は 10 秒ごとに読み直し、裏のタブでは止め、前に戻ると 1 回読んでから続ける', async () => {
    renderHook(() => useFirstRun('a', true, true))
    await flush()
    expect(net.progress).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(FIRST_RUN_WATCH_INTERVAL_MS) })
    expect(net.progress).toHaveBeenCalledTimes(2)
    act(() => setVisibility('hidden'))
    await act(async () => { vi.advanceTimersByTime(FIRST_RUN_WATCH_INTERVAL_MS * 3) })
    expect(net.progress).toHaveBeenCalledTimes(2)
    act(() => setVisibility('visible'))
    expect(net.progress).toHaveBeenCalledTimes(3)
    await act(async () => { vi.advanceTimersByTime(FIRST_RUN_WATCH_INTERVAL_MS) })
    expect(net.progress).toHaveBeenCalledTimes(4)
  })

  it('待っていない時は時間で読み直さない（タブが前に戻った時とスタイルの保存の時だけ）', async () => {
    renderHook(() => useFirstRun('a', true, false))
    await flush()
    await act(async () => { vi.advanceTimersByTime(FIRST_RUN_WATCH_INTERVAL_MS * 6) })
    expect(net.progress).toHaveBeenCalledTimes(1)
    act(() => setVisibility('hidden'))
    act(() => setVisibility('visible'))
    expect(net.progress).toHaveBeenCalledTimes(2)
    act(() => accountStyleUpdated('other'))
    expect(net.progress).toHaveBeenCalledTimes(2)
    act(() => accountStyleUpdated('a'))
    expect(net.progress).toHaveBeenCalledTimes(3)
  })

  it('15 分で止めて印を立て、もう一度確かめると読み直しを再開する', async () => {
    const { result } = renderHook(() => useFirstRun('a', true, true))
    await flush()
    await act(async () => { vi.advanceTimersByTime(FIRST_RUN_WATCH_LIMIT_MS + FIRST_RUN_WATCH_INTERVAL_MS) })
    expect(result.current.watchExpired).toBe(true)
    const calls = net.progress.mock.calls.length
    await act(async () => { vi.advanceTimersByTime(FIRST_RUN_WATCH_INTERVAL_MS * 3) })
    expect(net.progress).toHaveBeenCalledTimes(calls)
    act(() => result.current.rewatch())
    expect(result.current.watchExpired).toBe(false)
    await act(async () => { vi.advanceTimersByTime(FIRST_RUN_WATCH_INTERVAL_MS) })
    expect(net.progress.mock.calls.length).toBeGreaterThanOrEqual(calls + 2)
  })

  it('後ろで読み直している間も表示を読み込み中に戻さず、読み直しの失敗で済みの表示を消さない', async () => {
    const { result } = renderHook(() => useFirstRun('a', true, true))
    await flush()
    expect(result.current.status).toBe('ready')
    net.progress.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { vi.advanceTimersByTime(FIRST_RUN_WATCH_INTERVAL_MS) })
    await flush()
    expect(result.current.status).toBe('ready')
    net.progress.mockResolvedValue(reply('done'))
    await act(async () => { vi.advanceTimersByTime(FIRST_RUN_WATCH_INTERVAL_MS) })
    await flush()
    expect(result.current.steps.find((step) => step.key === 'firstMessage')?.state).toBe('done')
    expect(result.current.firstRun?.minutes).toBe(8)
  })
})
