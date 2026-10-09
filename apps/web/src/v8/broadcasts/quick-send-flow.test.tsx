// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn(), send: vi.fn(), get: vi.fn(), request: vi.fn(), preflight: vi.fn(), config: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: {
  tags: { list: async () => ({ success: true, data: [{ id: 'tag-a', name: '購入者' }] }) },
  broadcasts: { ...mocks, approval: { config: mocks.config, request: mocks.request, candidates: async () => ({ success: true, data: [{ id: 'owner', name: '担当', role: 'owner' }] }) } },
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
  await estimate()
}
async function estimate() { await act(async () => { vi.advanceTimersByTime(501); await Promise.resolve() }) }
beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.clearAllMocks()
  mocks.config.mockResolvedValue({ success: true, data: { threshold: 1000, singleOperator: false, operatorCount: 2 } })
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
  expect(mocks.send.mock.calls).toEqual([['created-1', undefined], ['created-1', undefined]])
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
  // 偽の時計なので findBy・waitFor は使わず、選ぶ窓をその場で操作する。
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'タグ：選ぶ' })) })
  const picker = screen.getAllByRole('dialog').at(-1)!
  await act(async () => { fireEvent.click(within(picker).getByRole('radio', { name: '購入者' })) })
  await act(async () => { fireEvent.click(within(picker).getByRole('button', { name: '選ぶ' })) })
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

it('WEB112: 設定の閾値と1人運用に従い人数を再入力して送信する', async () => {
  mocks.config.mockResolvedValue({ success: true, data: { threshold: 50, singleOperator: true, operatorCount: 1 } })
  mocks.preflight.mockResolvedValue({ success: true, data: { audienceCount: 60, hiddenExcluded: 0 } })
  await fill(); await estimate()
  expect(screen.queryByLabelText('承認する人')).toBeNull()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '送る', exact: true }).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('人数を入れる'), { target: { value: '60' } })
  await act(async () => screen.getByRole('button', { name: '送る', exact: true }).click())
  expect(mocks.send).toHaveBeenCalledWith('created-1', { confirmedRecipientCount: 60 })
  expect(mocks.request).not.toHaveBeenCalled()
})

it('WEB112: 確定前に人数が変わったら作成せず新しい人数を再確認する', async () => {
  mocks.config.mockResolvedValue({ success: true, data: { threshold: 50, singleOperator: true, operatorCount: 1 } })
  mocks.preflight.mockResolvedValue({ success: true, data: { audienceCount: 60, hiddenExcluded: 0 } })
  await fill()
  fireEvent.change(screen.getByLabelText('人数を入れる'), { target: { value: '60' } })
  mocks.preflight.mockResolvedValue({ success: true, data: { audienceCount: 61, hiddenExcluded: 0 } })
  await act(async () => screen.getByRole('button', { name: '送る', exact: true }).click())
  expect(mocks.create).not.toHaveBeenCalled()
  expect(mocks.send).not.toHaveBeenCalled()
  expect(screen.getByLabelText<HTMLInputElement>('人数を入れる').value).toBe('')
  fireEvent.change(screen.getByLabelText('人数を入れる'), { target: { value: '61' } })
  await act(async () => screen.getByRole('button', { name: '送る', exact: true }).click())
  expect(mocks.send).toHaveBeenCalledWith('created-1', { confirmedRecipientCount: 61 })
})
