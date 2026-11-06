// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import SearchField from './search-field'
import { nextListUrl } from './list-url-state'
afterEach(() => { cleanup(); vi.useRealTimers() })
test('検索は最後の入力から300ms待ち、途中の入力では実行しない', () => {
  vi.useFakeTimers(); const change = vi.fn()
  render(<SearchField aria-label="検索" value="" onChange={change} />)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'あ' } })
  act(() => vi.advanceTimersByTime(299))
  expect(change).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'あい' } })
  act(() => vi.advanceTimersByTime(300))
  expect(change).toHaveBeenCalledExactlyOnceWith('あい')
})
test('絞り込みだけを変えたら1ページ目に戻し、ページだけの変更は保つ', () => {
  const location = { pathname: '/list', search: '?page=7&id=42', hash: '#rows' }
  expect(nextListUrl(location, { q: '', page: '1' }, { q: '猫' })).toBe('/list?id=42&q=%E7%8C%AB#rows')
  expect(nextListUrl(location, { q: '', page: '1' }, { page: '2' })).toBe('/list?page=2&id=42#rows')
})
