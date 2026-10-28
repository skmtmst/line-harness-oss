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

it('先頭で次のカーソルがなければ件数だけを残し、次があれば進める', () => {
  const previous = vi.fn(), next = vi.fn()
  const props = { page: 1, pageSize: 20, shown: 5, total: 5, onPrevious: previous, onNext: next }
  const { rerender } = render(<CursorPagination {...props} hasNext={false} />)
  expect(screen.getByText('5件中 1〜5件')).toBeTruthy()
  expect(screen.queryByRole('navigation')).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
  expect(previous).not.toHaveBeenCalled()
  expect(next).not.toHaveBeenCalled()
  rerender(<CursorPagination {...props} total={25} hasNext />)
  fireEvent.click(screen.getByLabelText('前のページ'))
  fireEvent.click(screen.getByLabelText('次のページ'))
  expect(previous).not.toHaveBeenCalled()
  expect(next).toHaveBeenCalledOnce()
})

it.each([0, null, undefined] as const)('空の先頭でも総数%sを別の件数に置き換えない', (total) => {
  render(<CursorPagination page={1} pageSize={20} shown={0} total={total} hasNext={false} onPrevious={vi.fn()} onNext={vi.fn()} />)
  expect(screen.getByText(total === 0 ? '0件' : '—件中 0〜0件')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

it('空になった末尾でも前のカーソルへ戻れ、途中のカーソルでは前後へ進める', () => {
  const previous = vi.fn(), next = vi.fn()
  const props = { page: 2, pageSize: 20, shown: 0, total: null, onPrevious: previous, onNext: next }
  const { rerender } = render(<CursorPagination {...props} hasNext={false} />)
  expect(screen.getByLabelText('2ページ目').tagName).toBe('SPAN')
  fireEvent.click(screen.getByLabelText('前のページ'))
  fireEvent.click(screen.getByLabelText('次のページ'))
  expect(previous).toHaveBeenCalledOnce()
  expect(next).not.toHaveBeenCalled()
  rerender(<CursorPagination {...props} shown={20} hasNext />)
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
