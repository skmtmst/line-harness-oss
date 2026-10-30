// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import WaitFields from './wait-fields'
import CommonActionEditor from './common-action-editor'

afterEach(cleanup)
it('分数を編集し、翌日の待ち方へ切り替えられる', () => {
  const onChange = vi.fn()
  const { rerender } = render(<WaitFields allowNextDay value={{ durationMinutes: 30 }} onChange={onChange} />)
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '60' } })
  expect(onChange).toHaveBeenLastCalledWith({ durationMinutes: 60 })
  fireEvent.click(screen.getByRole('button', { name: '待ち方' }))
  fireEvent.click(within(screen.getByRole('option', { name: 'きっかけの翌日の時刻まで待つ' })).getByRole('button'))
  expect(onChange).toHaveBeenLastCalledWith({ mode: 'next_day', sendAtTime: '10:00' })
  rerender(<WaitFields value={{ mode: 'next_day', sendAtTime: '10:15' }} onChange={onChange} />)
  const time = screen.getByRole('combobox', { name: '翌日の時刻' }) as HTMLInputElement
  expect(time.value.replace(/\s/g,'')).toBe('10:15')
  fireEvent.change(time, { target: { value: '11:45' } })
  fireEvent.blur(time)
  expect(onChange).toHaveBeenLastCalledWith({ mode: 'next_day', sendAtTime: '11:45' })
  expect(screen.queryByRole('spinbutton')).toBeNull()
})

it('既存の分数は編集でき、新しい翌日の待ち方は選べない', () => {
  const onChange = vi.fn()
  render(<WaitFields value={{ durationMinutes: 30 }} onChange={onChange} />)
  expect(screen.queryByRole('button', { name: '待ち方' })).toBeNull()
  expect(screen.queryByRole('combobox', { name: '翌日の時刻' })).toBeNull()
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '60' } })
  expect(onChange).toHaveBeenLastCalledWith({ durationMinutes: 60 })
})

it('共通アクションでは待機を新しく追加できず、保存済みの分数は編集できる', () => {
  const onChange = vi.fn()
  render(<CommonActionEditor value={[{ id: 'saved-wait', type: 'wait', params: { durationMinutes: 30 }, onFailure: 'stop' }]}
    resources={{ tags: [], scenarios: [], templates: [], webhooks: [], richMenus: [], commonActions: [] }} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: '行うことを足す' }))
  expect(screen.queryByRole('menuitem', { name: '待つ', exact: true })).toBeNull()
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: '30 分待つ' }))
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '60' } })
  expect(onChange).toHaveBeenLastCalledWith([{ id: 'saved-wait', type: 'wait', params: { durationMinutes: 60 }, onFailure: 'stop' }])
  expect(screen.queryByRole('button', { name: '待ち方' })).toBeNull()
})
