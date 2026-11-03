// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import StockListHeading from './stock-list-heading'

it('飲食の在庫は空席の状況と案内する', () => {
  render(<StockListHeading date="2026-11-03" busy={false} onChange={vi.fn()} />)
  expect(screen.getByText(/空席の状況/)).toBeTruthy()
  expect(screen.queryByText(/埋まりぐあい/)).toBeNull()
})
