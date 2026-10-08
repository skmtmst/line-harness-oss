// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn(), send: vi.fn(), get: vi.fn(), request: vi.fn(), preflight: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: {
  tags: { list: async () => ({ success: true, data: [{ id: 'tag-a', name: '購入者' }] }) },
  broadcasts: { ...mocks, approval: { request: mocks.request, candidates: async () => ({ success: true, data: [{ id: 'owner', name: '担当', role: 'owner' }] }) } },
} }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/components/shared/select', () => ({ default: ({ value, onChange, options, ...props }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; 'aria-label': string }) => <select aria-label={props['aria-label']} value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }))
vi.mock('@/components/shared/date-time-field', () => ({ default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <input aria-label="送る日時" value={value} onChange={e => onChange(e.target.value)} /> }))
import QuickSend from './quick-send'
const onSent = vi.fn()
const onClose = vi.fn()
async function fill() {
  render(<QuickSend open accountId="account-a" onClose={onClose} onSent={onSent} />)
  await act(async () => {})
  fireEvent.change(screen.getByLabelText('本文'), { target: { value: 'お知らせ' } })
}
async function estimate() { await act(async () => { vi.advanceTimersByTime(501); await Promise.resolve() }) }
beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.clearAllMocks()
  mocks.create.mockResolvedValue({ success: true, data: { id: 'created-1' } })
  mocks.send.mockResolvedValue({ success: true })
  mocks.request.mockResolvedValue({ success: true })
  mocks.get.mockResolvedValue({ success: true, data: { status: 'draft', approvalStatus: null } })
  mocks.preflight.mockResolvedValue({ success: true, data: { audienceCount: 10, hiddenExcluded: 0 } })
})
afterEach(() => { cleanup(); vi.useRealTimers() })
it('日本時間10月5日10時を同じ時刻のISOで予約する', async () => {
  await fill()
  fireEvent.click(screen.getByRole('radio', { name: '日時を決める' }))
  fireEvent.change(screen.getByLabelText('送る日時'), { target: { value: '2026-10-05T10:00' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '予約する' })) })
  expect(mocks.create.mock.calls[0][0].scheduledAt).toBe('2026-10-05T01:00:00.000Z')
  expect(new Date(mocks.create.mock.calls[0][0].scheduledAt).getTime()).toBe(new Date('2026-10-05T10:00:00+09:00').getTime())
})
it('送信失敗後は同じ配信から再試行し、下書きを増やさない', async () => {
  mocks.send.mockResolvedValueOnce({ success: false, error: '通信失敗' })
  await fill()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '送る', exact: true })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '送る', exact: true })) })
  expect(mocks.create).toHaveBeenCalledTimes(1)
  expect(mocks.send.mock.calls).toEqual([['created-1'], ['created-1']])
  expect(onSent).toHaveBeenCalledTimes(1)
})
it('承認依頼の失敗後も同じ配信へ依頼する', async () => {
  mocks.preflight.mockResolvedValue({ success: true, data: { audienceCount: 1100, hiddenExcluded: 0 } })
  mocks.request.mockResolvedValueOnce({ success: false, error: '通信失敗' })
  await fill(); await estimate()
  fireEvent.change(screen.getByLabelText('承認する人'), { target: { value: 'owner' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '承認を頼む' })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '承認を頼む' })) })
  expect(mocks.create).toHaveBeenCalledTimes(1)
  expect(mocks.request.mock.calls).toEqual([['created-1', { approverStaffId: 'owner' }], ['created-1', { approverStaffId: 'owner' }]])
})
it('送信応答を失っても送信済みを確認して二重に送らない', async () => {
  mocks.send.mockRejectedValueOnce(new Error('応答なし'))
  await fill()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '送る', exact: true })) })
  mocks.get.mockResolvedValue({ success: true, data: { status: 'sent' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '送る', exact: true })) })
  expect(mocks.create).toHaveBeenCalledTimes(1)
  expect(mocks.send).toHaveBeenCalledTimes(1)
  expect(onSent).toHaveBeenCalledTimes(1)
})
it('同じ描画中の連打で二つ作らない', async () => {
  await fill()
  const button = screen.getByRole('button', { name: '送る', exact: true })
  await act(async () => { button.click(); button.click() })
  expect(mocks.create).toHaveBeenCalledTimes(1)
  expect(mocks.send).toHaveBeenCalledTimes(1)
})
it('対象を変えたあとに遅れて届いた前の人数を捨てる', async () => {
  let resolveOld!: (v: unknown) => void
  mocks.preflight.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  await fill(); await estimate()
  fireEvent.click(screen.getByRole('radio', { name: 'タグで絞る' }))
  fireEvent.change(screen.getByLabelText('タグ'), { target: { value: 'tag-a' } })
  await estimate()
  expect(screen.getByText(/10人に届く見込み/)).toBeTruthy()
  await act(async () => { resolveOld({ success: true, data: { audienceCount: 2000, hiddenExcluded: 0 } }) })
  expect(screen.queryByText(/2,000人に届く見込み/)).toBeNull()
  expect(screen.getByText(/10人に届く見込み/)).toBeTruthy()
})

it('書きかけでアカウントを切り替えると確認まで止まる', async () => {
  await fill()
  const change = vi.fn()
  const { requestUnsavedAction } = await import('@/lib/unsaved-action')
  act(() => requestUnsavedAction(change))
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
  expect(change).not.toHaveBeenCalled()
})
