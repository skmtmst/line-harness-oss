// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const send = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hq-broadcasts-api', () => ({ hqBroadcastsApi: { testSend: send } }))
import { HqTestSendDialog } from './approval'

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('テスト送信の窓で実際に選んだアカウントと環境を確認できる', () => {
  render(<HqTestSendDialog open accounts={[{ id: 'a', name: '本店LINE' }]} prepare={async () => 'draft'} onClose={() => {}} />)
  const dialog = screen.getByRole('dialog')
  expect(dialog.textContent).toContain('本店LINE')
  expect(dialog.textContent).toContain('LINEアカウント')
  expect(dialog.textContent).toContain('環境')
})

it('準備中に対象が切り替わればテスト送信を行わない', async () => {
  let finish!: (id: string | null) => void
  const prepare = vi.fn(() => new Promise<string | null>(resolve => { finish = resolve }))
  const view = render(<HqTestSendDialog open accounts={[{ id: 'a', name: '本店LINE' }]} prepare={prepare} onClose={() => {}} />)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'テストを送る' }))
  expect(prepare).toHaveBeenCalledTimes(1)
  view.rerender(<HqTestSendDialog open accounts={[{ id: 'b', name: '別店LINE' }]} prepare={prepare} onClose={() => {}} />)
  await act(async () => { finish('draft-a'); await Promise.resolve() })
  expect(send).not.toHaveBeenCalled()
})

it('対象を切り替えると準備中の応答を待たずに新しい対象を操作できる', async () => {
  let finishOld!: (id: string | null) => void
  let finishNew!: (id: string | null) => void
  const prepare = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve })).mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve }))
  send.mockResolvedValue({ data: { sent: 1, failed: 0 } })
  const view = render(<HqTestSendDialog open accounts={[{ id: 'a', name: '本店LINE' }]} prepare={prepare} onClose={() => {}} />)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'テストを送る' }))
  view.rerender(<HqTestSendDialog open accounts={[{ id: 'b', name: '別店LINE' }]} prepare={prepare} onClose={() => {}} />)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'テストを送る' }))
  expect(prepare).toHaveBeenCalledTimes(2)
  await act(async () => { finishOld('draft-a'); await Promise.resolve() })
  expect(send).not.toHaveBeenCalled()
  await act(async () => { finishNew('draft-b'); await Promise.resolve() })
  expect(send).toHaveBeenCalledExactlyOnceWith('draft-b', 'b')
})

it('確認したアカウントに一度だけテスト送信する', async () => {
  send.mockResolvedValue({ data: { sent: 1, failed: 0 } })
  const close = vi.fn()
  render(<HqTestSendDialog open accounts={[{ id: 'a', name: '本店LINE' }]} prepare={async () => 'draft-a'} onClose={close} />)
  const button = within(screen.getByRole('dialog')).getByRole('button', { name: 'テストを送る' })
  fireEvent.click(button); fireEvent.click(button)
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send).toHaveBeenCalledWith('draft-a', 'a')
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
})

it('窓の再表示では別の確定口を受け付けない', async () => {
  const prepare = vi.fn().mockResolvedValue('draft-a')
  const accounts = [{ id: 'a', name: '本店LINE' }]
  const view = render(<HqTestSendDialog open accounts={accounts} prepare={prepare} onClose={() => {}} />)
  const button = within(screen.getByRole('dialog')).getByRole('button', { name: 'テストを送る' })
  const key = Object.keys(button).find(name => name.startsWith('__reactProps$'))!
  const oldClick = (button as unknown as Record<string, { onClick: () => void }>)[key].onClick
  view.rerender(<HqTestSendDialog open={false} accounts={accounts} prepare={prepare} onClose={() => {}} />)
  view.rerender(<HqTestSendDialog open accounts={accounts} prepare={prepare} onClose={() => {}} />)
  await act(async () => { oldClick() })
  expect(prepare).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
})
