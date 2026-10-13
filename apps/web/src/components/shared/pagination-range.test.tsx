// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Pagination from './pagination'

afterEach(cleanup)

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
