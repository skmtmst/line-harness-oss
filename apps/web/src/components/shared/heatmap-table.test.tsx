// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import HeatmapTable from './heatmap-table'
afterEach(cleanup)
it('0人のマスは開け、未取得のマスは開けず、選択した行と列を返す', () => {
  const onSelect = vi.fn()
  render(<HeatmapTable label="人数" columns={['1回', '2回']} rows={[{ key: 'recent', label: '30日以内', cells: [{ key: 'one', name: '初めて', count: 0 }, { key: 'two', name: '常連', count: null }] }]} selected="recent:one" onSelect={onSelect} />)
  const zero = screen.getByRole('button', { name: '初めて 0 人' })
  expect(zero.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(zero)
  expect(onSelect).toHaveBeenCalledWith('recent', 'one')
  expect((screen.getByRole('button', { name: '常連 人数は未取得' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('rowheader', { name: '30日以内' })).toBeTruthy()
})
