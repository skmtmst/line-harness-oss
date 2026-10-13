// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ list: vi.fn(), retry: vi.fn(), history: vi.fn(), account: 'a' }))
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), api: { operations: {
  lineReceipts: f.list, retryLineReceipt: f.retry, history: f.history,
  health: vi.fn(async () => ({ success: true, data: { overallStatus: 'unknown', latestRun: null, lastCheckedAt: null } })),
  alerts: vi.fn(async () => ({ success: true, data: [] })),
} } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }))
import { HealthPanelV8 } from './health'
import { api, ApiError } from '@/lib/api'
const props = { accountId: 'a', manualRunRequest: 0, onSeverity: vi.fn(), canManage: true }
const receipt = (extra = {}) => ({ webhookEventId: 'safe', lineAccountId: 'a', eventType: 'message', status: 'failed', receivedAt: '2026-10-12T00:09:00+09:00', canRetry: true, recoveryStatus: null, recoveryReason: null, ...extra })
beforeEach(() => {
  vi.clearAllMocks()
  f.history.mockResolvedValue({ success: true, data: [] })
  f.list.mockResolvedValue({ success: true, data: [receipt()] })
  f.retry.mockResolvedValue({ success: true, status: 'succeeded' })
})
afterEach(cleanup)
it('要確認は理由と対応を表示し、canRetryが残っていても再送ややり直しを出さない', async () => {
  f.list.mockResolvedValue({ success: true, data: [receipt({ recoveryStatus: 'needs_review', recoveryReason: '返信の鍵が残っていません。' })] })
  render(<HealthPanelV8 {...props} />)
  await screen.findByText('要確認')
  expect(screen.getByText(/返信の鍵が残っていません/).textContent).toContain('履歴を照らし')
  expect(screen.getByText(/返信の鍵が残っていません/).textContent).toContain('担当者が返信')
  expect(screen.getByText(/返信の鍵が残っていません/).textContent).toContain('お客さまに送り直しを頼んで')
  expect(screen.queryByRole('button', { name: 'やり直す' })).toBeNull()
  expect(f.retry).not.toHaveBeenCalled()
})
it('安全な未完工程だけやり直し、連打を防ぎ、再取得して成功済みの操作を消す', async () => {
  let finish!: (value: unknown) => void
  f.retry.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  render(<HealthPanelV8 {...props} />)
  const button = await screen.findByRole('button', { name: 'やり直す' })
  fireEvent.click(button); fireEvent.click(button)
  expect(f.retry).toHaveBeenCalledExactlyOnceWith('safe')
  f.list.mockResolvedValue({ success: true, data: [] })
  await act(async () => { finish({ success: true, status: 'succeeded' }) })
  await waitFor(() => expect(screen.queryByRole('button', { name: 'やり直す' })).toBeNull())
  expect(f.list).toHaveBeenCalledTimes(2)
})
it('再処理で要確認になっても成功と表示せず、読み直した理由を残す', async () => {
  f.retry.mockRejectedValue(new Error('要確認：送達が不明です。'))
  render(<HealthPanelV8 {...props} />)
  const button = await screen.findByRole('button', { name: 'やり直す' })
  f.list.mockResolvedValue({ success: true, data: [receipt({ canRetry: false, recoveryStatus: 'needs_review', recoveryReason: '送達が不明です。' })] })
  fireEvent.click(button)
  await screen.findByText('要確認')
  expect(screen.queryByText(/残っていた工程をやり直しました/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'やり直す' })).toBeNull()
})
it('別アカウント・安全な工程なし・閲覧のみの操作は出さない', async () => {
  f.list.mockResolvedValue({ success: true, data: [receipt({ lineAccountId: 'other' }), receipt({ webhookEventId: 'none', canRetry: false })] })
  const view = render(<HealthPanelV8 {...props} />)
  await screen.findByRole('region', { name: 'LINE受信の失敗' })
  expect(screen.queryByRole('button', { name: 'やり直す' })).toBeNull()
  view.rerender(<HealthPanelV8 {...props} canManage={false} />)
  expect(screen.queryByRole('region', { name: 'LINE受信の失敗' })).toBeNull()
})
it('古いアカウントの遅い一覧を捨て、取得失敗を空の成功として扱わない', async () => {
  let finish!: (value: unknown) => void
  f.list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockRejectedValueOnce(new Error('fixture'))
  const view = render(<HealthPanelV8 {...props} />)
  view.rerender(<HealthPanelV8 {...props} accountId="other" />)
  await screen.findByText(/LINE受信の失敗を読み込めませんでした/)
  await act(async () => { finish({ success: true, data: [receipt()] }) })
  expect(screen.queryByRole('button', { name: 'やり直す' })).toBeNull()
  expect(screen.getByText(/失敗なしとは扱いません/)).toBeTruthy()
})

it('APIの内部エラーは日本語で案内し、失敗後の古い操作は隠す', async () => {
  f.retry.mockRejectedValue(new ApiError(500))
  render(<HealthPanelV8 {...props} />)
  const button = await screen.findByRole('button', { name: 'やり直す' })
  f.list.mockRejectedValue(new Error('fixture network failure'))
  fireEvent.click(button)
  await screen.findByText(/受信のやり直しに失敗しました/)
  await screen.findByText(/LINE受信の失敗を読み込めませんでした/)
  expect(document.body.textContent).not.toContain('API error: 500')
  expect(screen.queryByRole('button', { name: 'やり直す' })).toBeNull()
})

it('shows the unavailable MFA key notice in operation status without inventing a successful check', async () => {
  const notice = '二段階認証の鍵が未設定のため、必須にできません'
  vi.mocked(api.operations.health).mockResolvedValueOnce({ success: true, data: {
    overallStatus: 'unknown', latestRun: null, lastCheckedAt: null, nextCheckAt: null, serverNow: '2026-10-12T00:00:00Z', loginSecurity: { configured: false, notice },
  } })
  render(<HealthPanelV8 {...props} />)
  await screen.findByText(notice)
  expect(screen.queryByText('すべて正常')).toBeNull()
})
