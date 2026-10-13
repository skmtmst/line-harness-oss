// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Pagination from './pagination'

afterEach(cleanup)

const reason = (button: HTMLElement) => {
  const id = button.getAttribute('aria-describedby')
  return id ? document.getElementById(id)?.textContent : null
}

it('ページ境界と一時停止の理由を示し、移動できる操作から理由を外す', () => {
  const change = vi.fn()
  const { rerender } = render(<Pagination page={1} pageCount={2} onPageChange={change} />)
  expect(reason(screen.getByLabelText('前のページ'))).toBe('最初のページです。')
  expect(screen.getByLabelText('前のページ').getAttribute('title')).toBe('最初のページです。')
  expect(reason(screen.getByLabelText('次のページ'))).toBeNull()
  rerender(<Pagination page={2} pageCount={2} onPageChange={change} />)
  expect(reason(screen.getByLabelText('前のページ'))).toBeNull()
  expect(reason(screen.getByLabelText('次のページ'))).toBe('最後のページです。')
  rerender(<Pagination page={1} pageCount={2} disabled onPageChange={change} />)
  for (const button of screen.getAllByRole('button')) {
    expect(reason(button)).toBe('現在、ページを移動できません。')
    fireEvent.click(button)
  }
  expect(change).not.toHaveBeenCalled()
})

it.each([
  [1, 1, { total: 7, first: 1, last: 7 }, '7件中 1〜7件'],
  [2, 3, { total: 48, first: 21, last: 40 }, '48件中 21〜40件'],
  [1, 1, { total: 6, first: 1, last: 6, unit: '人' }, '6人中 1〜6人'],
  [1, 1, { total: 0, first: 0, last: 0 }, '0件'],
  [1, 1, { total: null, first: 1, last: 3 }, '—件中 1〜3件'],
  [1, 80, { total: 1234, first: 1, last: 20 }, '1,234件中 1〜20件'],
] as const)('総数と範囲だけから同じ件数文を描く', (page, pageCount, range, text) => {
  const change = vi.fn()
  render(<Pagination page={page} pageCount={pageCount} range={range} onPageChange={change} />)
  expect(screen.getByText(text)).toBeTruthy()
  expect(document.querySelectorAll('[data-pagination-summary]')).toHaveLength(1)
  fireEvent.click(screen.getByLabelText('次のページ'))
  if (page < pageCount) expect(change).toHaveBeenCalledWith(page + 1)
  else expect(change).not.toHaveBeenCalled()
})
