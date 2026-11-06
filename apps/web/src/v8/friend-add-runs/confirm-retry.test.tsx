// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import Detail from './detail'
const net = vi.hoisted(() => ({ read: vi.fn(), retry: vi.fn(), toast: vi.fn() }))
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(), useSearchParams: () => new URLSearchParams('id=run') }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('@/components/shared/toast', async original => ({ ...await original<typeof import('@/components/shared/toast')>(), notifyToast: net.toast }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, friendAddRules: { ...actual.api.friendAddRules, runDetail: net.read, retryRun: net.retry } } }
})
const detail = { success: true, data: { id: 'run', receivedAt: '2026-10-01T10:00:00+09:00', processedAt: null,
  friend: { id: 'friend', displayName: '確認用の友だち', redacted: false }, friendKind: 'first_time',
  attribution: { status: 'unavailable', routeId: null, routeName: null, reason: null },
  rule: { id: 'rule', name: '初回案内', versionId: 'version', versionNumber: 1 },
  actionRuns: [{ id: 'action', stableId: 'version:0', type: 'tag', status: 'completed', attemptCount: 1, nextRetryAt: null, errorCode: null, startedAt: null, completedAt: null, updatedAt: null }],
  status: 'partial_failed', errorCode: 'send_failed',
} }
beforeEach(() => { vi.clearAllMocks(); net.read.mockResolvedValue(detail); net.retry.mockResolvedValue({ success: true, data: { retried: 1 } }) })
afterEach(cleanup)
it.each(['成功', '409'])('再試行の%s後の読み直しで画面を消さず、前の操作という誤通知と自動再送を出さない', async outcome => {
  render(<Detail />)
  fireEvent.click(await screen.findByRole('button', { name: '失敗した処理をもう一度' }))
  const dialog = await screen.findByRole('dialog', { name: '失敗した処理をもう一度行いますか？' })
  let finish!: (value: typeof detail) => void
  net.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  if (outcome === '409') net.retry.mockRejectedValueOnce(new ApiError(409, 'すでに処理中です。'))
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'もう一度行う' })) })
  expect(net.retry).toHaveBeenCalledTimes(1)
  expect(net.read).toHaveBeenCalledTimes(2)
  expect(screen.getByText('確認用の友だち')).toBeTruthy()
  expect(screen.queryByLabelText('実行詳細を読み込んでいます')).toBeNull()
  if (outcome === '409') expect(screen.getByRole('dialog', { name: '失敗した処理をもう一度行いますか？' })).toBe(dialog)
  await act(async () => { finish(detail) })
  if (outcome === '409') {
    expect(within(dialog).getByRole('alert')).toBeTruthy()
    const retry = within(dialog).getByRole('button', { name: 'もう一度' })
    expect(retry.hasAttribute('disabled')).toBe(true)
    fireEvent.click(retry); expect(net.retry).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '失敗した処理をもう一度' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    const open = await screen.findByRole('button', { name: '失敗した処理をもう一度' })
    expect(open.hasAttribute('disabled')).toBe(false)
    expect(net.read).toHaveBeenCalledTimes(3)
    fireEvent.click(open)
    const fresh = await screen.findByRole('dialog', { name: '失敗した処理をもう一度行いますか？' })
    expect(within(fresh).queryByRole('alert')).toBeNull()
    await act(async () => { const submit = within(fresh).getByRole('button', { name: 'もう一度行う' }); fireEvent.click(submit); fireEvent.click(submit) })
    expect(net.retry.mock.calls).toEqual([['account', 'run'], ['account', 'run']])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  } else await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(net.toast.mock.calls.some(([message]) => String(message).includes('前の操作'))).toBe(false)
})
