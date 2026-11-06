// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import AdMappingDialog from './ad-mapping-dialog'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

afterEach(cleanup)
it('広告の対応を連続確定しても1回だけ保存し、拒否の後も入力を保持して再保存できる', async () => {
  let fail!: (error: Error) => void
  const save = vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject })).mockResolvedValue(true)
  render(<AdMappingDialog item={{ pointId: 'point-1', eventType: 'booking_created', automaticEventName: 'Schedule', version: 1, pointName: '予約', provider: 'google', mode: 'manual', eventName: '予約完了', googleActionId: '123' }} onSave={save} onClose={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('予約 googleに返す名前'), { target: { value: '来店予約' } })
  const button = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
  act(() => { button.click(); button.click() })
  expect(save).toHaveBeenCalledTimes(1)
  expect(button.disabled).toBe(true)
  await act(async () => { fail(new ApiError(403)) })
  expect(screen.getByText(/このLINEアカウントや権限では保存できません/)).toBeTruthy()
  expect((screen.getByLabelText('予約 googleに返す名前') as HTMLInputElement).value).toBe('来店予約')
  await act(async () => { fireEvent.click(button) })
  expect(save).toHaveBeenCalledTimes(2)
  expect(save).toHaveBeenLastCalledWith({ mode: 'manual', eventName: '来店予約', googleActionId: '123' })
})
