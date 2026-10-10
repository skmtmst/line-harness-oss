// @vitest-environment happy-dom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PhoneDatetimeStep } from './phone'

afterEach(cleanup)

it.each(['error', 'loading'] as const)('空きを読めない状態（%s）は満席や選択済みにしない', (status) => {
  const onRetry = vi.fn()
  render(<PhoneDatetimeStep menu={null} staffName={null} slots={[{ date: '2099-10-15', start: '09:00', end: '10:00', remaining: 1 }]} closedDates={[]} closedWeekdays={[]} status={status} onRetry={onRetry} />)
  expect(screen.queryAllByText('満')).toHaveLength(0)
  expect(screen.queryAllByText('空き')).toHaveLength(0)
  expect(screen.getByText('内容を確かめる').getAttribute('data-off')).toBe('true')
  if (status === 'error') {
    expect(screen.getByText('読み込めませんでした')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    expect(onRetry).toHaveBeenCalledOnce()
  }
})

it('読み込めた満席の日だけ満と表示する', () => {
  render(<PhoneDatetimeStep menu={null} staffName={null} slots={[{ date: '2099-10-15', start: '09:00', end: '10:00', remaining: 0 }]} closedDates={[]} closedWeekdays={[]} />)
  expect(screen.getAllByText('満').length).toBeGreaterThan(0)
  expect(screen.queryByText('読み込めませんでした')).toBeNull()
})
