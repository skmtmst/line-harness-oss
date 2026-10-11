// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import KpiCard from './kpi-card'

afterEach(cleanup)

it('数から既存の内訳を開閉でき、読み込み中は操作できない', () => {
  const onClick = vi.fn()
  const props = { title: '今日の予約', value: 3, unit: '件', detail: '次の予定 16:00', valueAction: { label: '今日の予約の内訳を見る', expanded: false, onClick } }
  const { rerender } = render(<KpiCard {...props} />)
  const button = screen.getByRole('button', { name: props.valueAction.label })
  expect(button.textContent).toBe('3件')
  expect(button.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(button)
  expect(onClick).toHaveBeenCalledOnce()
  rerender(<KpiCard {...props} valueAction={{ ...props.valueAction, expanded: true }} />)
  expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
  rerender(<KpiCard {...props} loading />)
  expect(screen.queryByRole('button')).toBeNull()
})
