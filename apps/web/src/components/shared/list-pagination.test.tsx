// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ListPagination from './list-pagination'

afterEach(cleanup)

it('全件が1ページなら件数と現在地を残し、移動は送らない', () => {
  const change = vi.fn()
  render(<ListPagination total={4} page={1} pageSize={20} unit="人" onPageChange={change} />)
  expect(screen.getByText('4人中 1〜4人')).toBeTruthy()
  expect(screen.getByRole('button', { name: '1ページ目へ' }).getAttribute('aria-current')).toBe('page')
  fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
  expect(change).not.toHaveBeenCalled()
})

it('表示件数を減らすと次へ進め、絞り込みでページが減ると範囲を戻す', () => {
  const change = vi.fn()
  const { rerender } = render(<ListPagination total={25} page={1} pageSize={10} onPageChange={change} />)
  expect(screen.getByText('25件中 1〜10件')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
  expect(change).toHaveBeenCalledWith(2)
  rerender(<ListPagination total={3} page={3} pageSize={10} onPageChange={change} />)
  expect(screen.getByText('3件中 1〜3件')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '3ページ目へ' })).toBeNull()
})

it('0件と取得できない値を分ける', () => {
  const { rerender } = render(<ListPagination total={0} page={1} pageSize={20} onPageChange={() => {}} />)
  expect(screen.getByText('0件')).toBeTruthy()
  rerender(<ListPagination total={NaN} page={1} pageSize={20} onPageChange={() => {}} />)
  expect(screen.getByText('—件中 0〜0件')).toBeTruthy()
})
