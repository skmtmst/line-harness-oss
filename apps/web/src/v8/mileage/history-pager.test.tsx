// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import HistoryPager from './history-pager'

afterEach(cleanup)
it('履歴が1ページでも件数と境界のページ送りを出す', () => {
  render(<HistoryPager spentOnly={false} total={2} page={1} pageSize={20} items={{ length: 2 }} pageCount={1} loading={false} setPage={() => {}} />)
  const pager = screen.getByRole('navigation', { name: 'ページ送り' })
  expect(pager.querySelector('[data-pagination-summary]')?.textContent).toBe('2件中 1〜2件')
  expect(within(pager).getByRole('button', { name: '前のページ' }).hasAttribute('disabled')).toBe(true)
  expect(within(pager).getByRole('button', { name: '次のページ' }).hasAttribute('disabled')).toBe(true)
})
it('取得できない総数を0へ置き換えず、次のページへ移れる', () => {
  const setPage = vi.fn()
  render(<HistoryPager spentOnly={false} total={null} page={1} pageSize={20} items={{ length: 2 }} pageCount={2} loading={false} setPage={setPage} />)
  const pager = screen.getByRole('navigation', { name: 'ページ送り' })
  expect(pager.querySelector('[data-pagination-summary]')?.textContent).toBe('—件中 1〜2件')
  fireEvent.click(within(pager).getByRole('button', { name: '次のページ' }))
  expect(setPage).toHaveBeenCalledWith(2)
})
it('ページ内の使った件数と全履歴の範囲を分け、空のページでも次へ進める', () => {
  const setPage = vi.fn()
  render(<HistoryPager spentOnly total={60} page={1} pageSize={20} items={{ length: 0 }} pageCount={3} loading={false} setPage={setPage} />)
  const pager = screen.getByRole('navigation', { name: 'ページ送り' })
  expect(pager.querySelector('[data-pagination-summary]')?.textContent).toBe('60件中 1〜20件')
  expect(screen.getByText('このページのうち、使った・取り消し 0 件')).toBeTruthy()
  fireEvent.click(within(pager).getByRole('button', { name: '次のページ' }))
  expect(setPage).toHaveBeenCalledWith(2)
})

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
