// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CursorPagination } from './pagination'

afterEach(cleanup)

it('カーソルの現在地だけを表示し、前・次の既存操作へ渡す', () => {
  const previous = vi.fn(), next = vi.fn()
  render(<CursorPagination page={3} pageSize={20} shown={8} total={48} hasNext={false} onPrevious={previous} onNext={next} />)
  expect(screen.getByText('48件中 41〜48件')).toBeTruthy()
  expect(screen.getByLabelText('3ページ目').tagName).toBe('SPAN')
  expect(screen.queryByLabelText('1ページ目へ')).toBeNull()
  fireEvent.click(screen.getByLabelText('前のページ'))
  fireEvent.click(screen.getByLabelText('次のページ'))
  expect(previous).toHaveBeenCalledOnce()
  expect(next).not.toHaveBeenCalled()
})

it('1ページでも枠を出し、次のカーソルがある時だけ進む', () => {
  const previous = vi.fn(), next = vi.fn()
  const props = { page: 1, pageSize: 20, shown: 5, total: 5, onPrevious: previous, onNext: next }
  const { rerender } = render(<CursorPagination {...props} hasNext={false} />)
  expect(screen.getByText('5件中 1〜5件')).toBeTruthy()
  fireEvent.click(screen.getByLabelText('前のページ'))
  fireEvent.click(screen.getByLabelText('次のページ'))
  expect(previous).not.toHaveBeenCalled()
  expect(next).not.toHaveBeenCalled()
  rerender(<CursorPagination {...props} total={25} hasNext />)
  fireEvent.click(screen.getByLabelText('次のページ'))
  expect(next).toHaveBeenCalledOnce()
})

it('処理中の移動を止め、未取得の総数を0と表示しない', () => {
  const next = vi.fn()
  render(<CursorPagination page={1} pageSize={20} shown={3} total={null} hasNext disabled onPrevious={vi.fn()} onNext={next} />)
  expect(screen.getByText('—件中 1〜3件')).toBeTruthy()
  fireEvent.click(screen.getByLabelText('次のページ'))
  expect(next).not.toHaveBeenCalled()
})
