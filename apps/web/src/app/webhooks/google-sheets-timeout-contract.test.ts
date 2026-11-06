// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useSheets } from '@/v8/webhooks/use-sheets'

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', selectedAccount: null, accounts: [] }) }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner' }))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/v8/webhooks/shell', () => ({ useWebhookOverview: () => ({}) }))

const connection = { success: true, data: { connection: { status: 'disconnected' }, canManage: true, oauthConfigured: true, syncRunning: false } }
const runs = { success: true, data: { runs: [] } }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('R151 Google Sheets 連携の読み込みは期限付き', () => {
  it('接続状態と履歴の取得に打ち切り時刻を渡す', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const calls: Array<{ path: string; signal: AbortSignal | null | undefined }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      calls.push({ path, signal: init?.signal })
      return new Response(JSON.stringify(path.endsWith('/runs') ? runs : connection), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const { result } = renderHook(useSheets)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(timeout).toHaveBeenCalledWith(30_000)
    const requests = calls.filter(call => call.path.includes('/google-sheets/'))
    expect(requests.some(call => call.path.endsWith('/connection'))).toBe(true)
    expect(requests.some(call => call.path.endsWith('/runs'))).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests[0].signal).toBeInstanceOf(AbortSignal)
    expect(requests[1].signal).toBe(requests[0].signal)
  })

  it.each(['打ち切り', '失敗', '不正応答'])('打ち切り・失敗・不正応答のどれでも読み込み状態を終えて再試行できる（%s）', async failure => {
    const loadConnection = vi.spyOn(api.webhooks.googleSheets, 'connection')
    const loadRuns = vi.spyOn(api.webhooks.googleSheets, 'runs')
    if (failure === '不正応答') {
      loadConnection.mockResolvedValueOnce({ success: true, data: {} } as never)
      loadRuns.mockResolvedValueOnce({ success: true, data: {} } as never)
    } else {
      const error = failure === '打ち切り' ? new DOMException('時間切れ', 'TimeoutError') : new Error('通信失敗')
      loadConnection.mockRejectedValueOnce(error)
      loadRuns.mockRejectedValueOnce(error)
    }
    loadConnection.mockResolvedValue(connection as never)
    loadRuns.mockResolvedValue(runs as never)
    const { result } = renderHook(useSheets)
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.runsLoading).toBe(false)
    expect(result.current.runsError).toBeTruthy()
    await act(async () => { await result.current.load() })
    expect(result.current.status).toBe('ready')
    expect(result.current.runsLoading).toBe(false)
    expect(result.current.runsError).toBe('')
    expect(loadConnection).toHaveBeenCalledTimes(2)
    expect(loadRuns).toHaveBeenCalledTimes(2)
  })
})
