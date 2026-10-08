// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ schedule: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { chats: { schedule: mocks.schedule }, templates: { list: mocks.list } } }))
import ScheduleDialog from './schedule-dialog'
beforeEach(() => {
  vi.resetAllMocks()
  document.documentElement.dataset.theme = 'v8'
  mocks.list.mockResolvedValue({ success: true, data: [] })
})
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })
it('WEB244: 通信例外の後も入力を保持し、同じ操作キーで再試行して成功時だけ閉じる', async () => {
  let reject!: (reason: Error) => void
  mocks.schedule.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    .mockResolvedValueOnce({ success: true, data: { id: 'a' } })
  const onClose = vi.fn(), onReserved = vi.fn()
  render(<ScheduleDialog friendId="f-1" friendName="ソラ" accountId="acc-1" onClose={onClose} onReserved={onReserved} />)
  fireEvent.change(screen.getByRole('textbox', { name: '送るもの' }), { target: { value: '明日の案内' } })
  const reserve = screen.getByRole('button', { name: /に予約$/ }) as HTMLButtonElement
  fireEvent.click(reserve)
  expect(reserve.disabled).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { reject(new Error('Network disconnected')); await Promise.resolve() })
  await waitFor(() => { expect(reserve.disabled).toBe(false) })
  expect(screen.getByRole('alert').textContent).toContain('予約できませんでした')
  expect((screen.getByRole('textbox', { name: '送るもの' }) as HTMLTextAreaElement).value).toBe('明日の案内')
  expect(onClose).not.toHaveBeenCalled()
  expect(onReserved).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(reserve) })
  expect(mocks.schedule).toHaveBeenCalledTimes(2)
  expect(mocks.schedule.mock.calls[1]).toEqual(mocks.schedule.mock.calls[0])
  expect(mocks.schedule.mock.calls[0][2]).toBeTruthy()
  expect(onReserved).toHaveBeenCalledTimes(1)
  expect(onClose).toHaveBeenCalledTimes(1)
})
it('予約失敗後はキャンセル・Escが再び使える', async () => {
  mocks.schedule.mockRejectedValue(new Error('HTTP 500'))
  const onClose = vi.fn()
  render(<ScheduleDialog friendId="f-1" friendName="ソラ" accountId="acc-1" onClose={onClose} onReserved={() => {}} />)
  fireEvent.change(screen.getByRole('textbox', { name: '送るもの' }), { target: { value: '案内' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /に予約$/ })) })
  await waitFor(() => { expect((screen.getByRole('button', { name: 'キャンセル' }) as HTMLButtonElement).disabled).toBe(false) })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(onClose).toHaveBeenCalledTimes(2)
})
