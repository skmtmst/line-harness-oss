// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import ReorderList from './reorder-list'

afterEach(cleanup)
test('両端を動かせない理由を伝え、動かせる矢印だけが並びを返す', () => {
  const change = vi.fn()
  render(<ReorderList items={[{ id: 'a', label: '一斉配信' }, { id: 'b', label: 'シナリオ配信' }]} onChange={change} />)
  expect(screen.getByRole('button', { name: '一斉配信を上へ' }).title).toContain('先頭')
  expect(screen.getByRole('button', { name: 'シナリオ配信を下へ' }).title).toContain('最後')
  fireEvent.click(screen.getByRole('button', { name: '一斉配信を下へ' }))
  expect(change).toHaveBeenCalledWith(['b', 'a'])
})
