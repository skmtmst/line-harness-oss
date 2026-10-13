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
