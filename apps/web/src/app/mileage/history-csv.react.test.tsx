// @vitest-environment happy-dom
import React, { useState, type ReactNode } from 'react'
import { Blob as NodeBlob } from 'node:buffer'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ account: 'A', history: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: mocks.account, loading: false }),
}))
vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(), api: { mileage: { history: mocks.history } },
}))
import V8HistoryTab from './v8-history-tab'

function Screen() {
  const [actions, setActions] = useState<ReactNode>(null)
  return <>{actions}<V8HistoryTab readonly registerHeaderActions={setActions} /></>
}
const result = (name: string) => ({
  success: true, data: {
    items: [{
      id: name, primaryFriendId: 'f', displayName: name, lineAccountName: 'お店',
      occurredAt: '2026-10-04T00:00:00Z', amount: 100, reason: '付与の理由', entryType: 'grant',
      status: 'available', mode: 'automatic', executedByStaffName: null, balanceAfter: 500,
      source: 'purchase', sourceReferenceId: null, hasSourceEvent: false,
    }],
    summary: { byType: [] }, pagination: { total: 1, limit: 20, offset: 0 },
  },
})
let blob: NodeBlob | undefined
let download: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  mocks.account = 'A'
  mocks.history.mockReset()
  blob = undefined
  vi.stubGlobal('Blob', NodeBlob)
  vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => { blob = value as NodeBlob; return 'blob:csv' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const ready = () => waitFor(() => expect(screen.getByRole('button', { name: 'CSV で書き出す' }).hasAttribute('disabled')).toBe(false))

test('絞り込み前後の件数が同じでも、表示中の新しい履歴を書き出す', async () => {
  mocks.history.mockResolvedValueOnce(result('前の会員')).mockResolvedValueOnce(result('=次の会員,"B"'))
  render(<Screen />)
  await ready()
  fireEvent.click(screen.getByRole('button', { name: '付けた' }))
  await waitFor(() => expect(screen.getByText('=次の会員,"B"')).toBeTruthy())
  await ready()
  fireEvent.click(screen.getByRole('button', { name: 'CSV で書き出す' }))
  expect(download).toHaveBeenCalledOnce()
  expect(await blob!.text()).toContain('"\'=次の会員,""B"""')
  expect(await blob!.text()).not.toContain('前の会員')
  expect(mocks.history.mock.calls[1][0].entryType).toBe('grant')
})

test('アカウント切り替え中は書き出せず、同じ件数で読み込み終わっても前のお店は混ざらない', async () => {
  mocks.history.mockResolvedValueOnce(result('Aの会員'))
  const rendered = render(<Screen />)
  await ready()
  let resolve!: (value: ReturnType<typeof result>) => void
  mocks.history.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  mocks.account = 'B'
  rendered.rerender(<Screen />)
  expect(screen.getByRole('button', { name: 'CSV で書き出す' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'CSV で書き出す' }))
  expect(download).not.toHaveBeenCalled()
  await act(async () => resolve(result('Bの会員')))
  await ready()
  fireEvent.click(screen.getByRole('button', { name: 'CSV で書き出す' }))
  expect(await blob!.text()).toContain('Bの会員')
  expect(await blob!.text()).not.toContain('Aの会員')
})

test('保存に失敗しても履歴を残し、再試行できる', async () => {
  mocks.history.mockResolvedValue(result('テスト会員'))
  render(<Screen />)
  await ready()
  vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw new Error('download') })
  fireEvent.click(screen.getByRole('button', { name: 'CSV で書き出す' }))
  expect(screen.getByText('CSVを書き出せませんでした。もう一度お試しください。')).toBeTruthy()
  expect(screen.getByText('テスト会員')).toBeTruthy()
  expect(download).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'CSV で書き出す' }))
  expect(download).toHaveBeenCalledOnce()
})
