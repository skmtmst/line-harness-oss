// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import MonthCalendarGrid from './month-calendar'
afterEach(cleanup)
it('月外・休み・今日と予約数を保ち、押した日付を返す', () => {
  const onDay = vi.fn()
  render(<MonthCalendarGrid title="2026年10月" days={[
    { date: '2026-09-30', day: '30', inMonth: false, closed: true },
    { date: '2026-10-01', day: '1', inMonth: true, today: true, groups: 3, people: 6 },
  ]} onDay={onDay} />)
  expect(screen.getAllByRole('columnheader')).toHaveLength(7)
  const [outside, today] = screen.getAllByRole('gridcell')
  expect(outside.hasAttribute('data-out')).toBe(true)
  expect(outside.textContent).toContain('定休日')
  expect(today.hasAttribute('data-today')).toBe(true)
  expect(today.textContent).toContain('3組6人')
  fireEvent.click(today)
  expect(onDay).toHaveBeenCalledWith('2026-10-01')
})

it('今日と選択した日を別々に示し、選んだ日を返す', () => {
  const onDay = vi.fn()
  render(<MonthCalendarGrid title="2026年10月" days={[
    { date: '2026-10-22', day: '22', inMonth: true, today: true },
    { date: '2026-10-23', day: '23', inMonth: true, selected: true },
  ]} onDay={onDay} />)
  const today = screen.getByRole('gridcell', { name: '2026-10-22・今日' })
  const selected = screen.getByRole('gridcell', { name: '2026-10-23・選択中' })
  expect(today.getAttribute('aria-current')).toBe('date')
  expect(today.getAttribute('aria-selected')).toBe('false')
  expect(today.textContent).toContain('今日')
  expect(selected.getAttribute('aria-selected')).toBe('true')
  expect(selected.hasAttribute('aria-current')).toBe(false)
  fireEvent.click(selected)
  expect(onDay).toHaveBeenCalledWith('2026-10-23')
})
