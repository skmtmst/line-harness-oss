// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import HistoryPager from './history-pager'

afterEach(cleanup)
const props = { spentOnly: false, page: 1, pageSize: 20, items: { length: 3 }, total: 3, pageCount: 1, loading: false }

it('1ページも件数と前後の枠を残す', () => {
  const setPage = vi.fn()
  render(<HistoryPager {...props} setPage={setPage} />)
  expect(screen.getByText('3件中 1〜3件')).toBeTruthy()
  for (const label of ['前のページ', '次のページ']) {
    const button = screen.getByRole('button', { name: label }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
  }
  expect(setPage).not.toHaveBeenCalled()
})

it('未取得の総数を0にせず、手元の絞り込みと次ページを保つ', () => {
  const setPage = vi.fn()
  render(<HistoryPager {...props} total={null} spentOnly pageCount={2} items={{ length: 0 }} setPage={setPage} />)
  expect(screen.getByText('—件のうち、使った・取り消し 0 件')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
  expect(setPage).toHaveBeenCalledWith(2)
})
