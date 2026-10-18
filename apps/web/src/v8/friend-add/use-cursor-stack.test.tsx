// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useCursorStack } from './use-cursor-stack'
afterEach(cleanup)
it('URLから戻ったページの前後をたどり、空カーソルを積まず絞り込みで先頭へ戻る', () => {
  const { result } = renderHook(() => useCursorStack([null, 'p2', 'p3']))
  expect(result.current).toMatchObject({ cursor: 'p3', page: 3, canPrev: true })
  act(() => result.current.goPrev())
  expect(result.current.cursor).toBe('p2')
  act(() => { result.current.goNext(null); result.current.goNext(undefined) })
  expect(result.current.page).toBe(2)
  act(() => result.current.goNext('p3-new'))
  expect(result.current.cursor).toBe('p3-new')
  act(() => result.current.reset())
  act(() => result.current.goPrev())
  expect(result.current).toMatchObject({ stack: [null], cursor: null, page: 1, canPrev: false })
})
