// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ preflight: vi.fn(), distribute: vi.fn(), saved: vi.fn() }))
vi.mock('@/lib/api/helpers/styles', () => ({ hqStyleApi: { preflight: net.preflight, distribute: net.distribute } }))
vi.mock('@/components/shared/toast', () => ({ notifySaved: net.saved }))
import { DISTRIBUTE_ACCOUNT_LIMIT, useDistribute } from './use-distribute'

const preview = (token: string, accountCount: number) => ({ success: true, data: { token, accountCount, editedCount: 1, accounts: [] } })
beforeEach(() => {
  vi.clearAllMocks()
  net.preflight.mockImplementation(async (_style: string, body: { target: { style?: string; accountIds?: string[] } }) => preview(body.target.style ? 'style-token' : 'pick-token', body.target.style ? 4 : body.target.accountIds!.length))
  net.distribute.mockResolvedValue({ success: true, data: { accountCount: 4, items: [{ accountId: 'a', key: 'menu', action: 'pending' }] } })
})
afterEach(cleanup)

it('配る先の数を preflight で確かめ、その token と編集済みの物の扱いを付けて 1 回だけ配る', async () => {
  const done = vi.fn()
  const { result } = renderHook(() => useDistribute('salon', 7, done))
  await act(async () => result.current.setDraft({ target: 'style', accounts: [], editedAction: 'notify' }))
  await waitFor(() => expect(result.current.preview?.accountCount).toBe(4))
  expect(net.preflight).toHaveBeenCalledWith('salon', { expectedVersion: 7, target: { style: 'salon' } })
  expect(net.distribute).not.toHaveBeenCalled()
  await act(async () => { await result.current.run() })
  expect(net.distribute).toHaveBeenCalledExactlyOnceWith('salon', { expectedVersion: 7, target: { style: 'salon' }, token: 'style-token', confirmed: true, editedAction: 'notify' })
  expect(net.saved.mock.calls[0][0]).toContain('保留')
  expect(done).toHaveBeenCalled()
  expect(result.current.draft).toBeNull()
})

it('配る先を変えたら読み直すまで配れず、古い token では送らない', async () => {
  const { result } = renderHook(() => useDistribute('salon', 7, vi.fn()))
  await act(async () => result.current.setDraft({ target: 'style', accounts: [], editedAction: 'new_copy' }))
  await waitFor(() => expect(result.current.preview).not.toBeNull())
  let release!: (value: unknown) => void
  net.preflight.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
  await act(async () => result.current.setDraft({ target: 'pick', accounts: ['b', 'a'], editedAction: 'new_copy' }))
  expect(result.current.preview).toBeNull()
  await act(async () => { await result.current.run() })
  expect(net.distribute).not.toHaveBeenCalled()
  await act(async () => { release(preview('pick-token', 2)) })
  await waitFor(() => expect(result.current.preview?.accountCount).toBe(2))
  await act(async () => { await result.current.run() })
  expect(net.distribute).toHaveBeenCalledExactlyOnceWith('salon', expect.objectContaining({ target: { accountIds: ['a', 'b'] }, token: 'pick-token', editedAction: 'new_copy' }))
})

it('選んだアカウントが 0 件・上限より多い時は preflight も配るも呼ばない', async () => {
  const { result } = renderHook(() => useDistribute('salon', 7, vi.fn()))
  await act(async () => result.current.setDraft({ target: 'pick', accounts: [], editedAction: 'notify' }))
  await act(async () => result.current.setDraft({ target: 'pick', accounts: Array.from({ length: DISTRIBUTE_ACCOUNT_LIMIT + 1 }, (_, i) => `a${i}`), editedAction: 'notify' }))
  expect(result.current.tooMany).toBe(true)
  await act(async () => { await result.current.run() })
  expect(net.preflight).not.toHaveBeenCalled()
  expect(net.distribute).not.toHaveBeenCalled()
})

it('配るのに失敗したら窓を残して失敗を出す', async () => {
  net.distribute.mockRejectedValueOnce(new Error('offline'))
  const done = vi.fn()
  const { result } = renderHook(() => useDistribute('salon', 7, done))
  await act(async () => result.current.setDraft({ target: 'style', accounts: [], editedAction: 'notify' }))
  await waitFor(() => expect(result.current.preview).not.toBeNull())
  await act(async () => { await result.current.run() })
  expect(result.current.draft).not.toBeNull()
  expect(result.current.error).not.toBe('')
  expect(done).not.toHaveBeenCalled()
})
