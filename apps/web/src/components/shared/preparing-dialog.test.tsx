// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import PreparingDialog, { PREPARING_TITLE, usePreparingDialog } from './preparing-dialog'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))

afterEach(cleanup)

test('機能の名前を入れて「現在準備中です」を出し、右上の×で閉じる（フッターの閉じるは置かない・UI-25）', () => {
  const close = vi.fn()
  render(<PreparingDialog open feature="お支払い" onClose={close} />)
  expect(screen.getByRole('dialog', { name: PREPARING_TITLE })).toBeTruthy()
  expect(screen.getByText('「お支払い」は、いま準備をしています。使えるようになったら、お知らせでお伝えします。')).toBeTruthy()
  expect(screen.getByText('今の予約やデータには影響ありません。')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'お知らせを見る' }).getAttribute('href')).toBe('/notifications')
  /* 「閉じる」という名の操作は右上の×だけ。 */
  expect(screen.getAllByRole('button', { name: '閉じる' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
  expect(close).toHaveBeenCalled()
})

test('usePreparingDialog は押したボタンの機能の名前で開き、閉じると消える', () => {
  const { result } = renderHook(() => usePreparingDialog())
  expect(result.current.feature).toBeNull()
  act(() => result.current.open('画像を変える'))
  expect(result.current.feature).toBe('画像を変える')
  act(() => result.current.close())
  expect(result.current.feature).toBeNull()
})
