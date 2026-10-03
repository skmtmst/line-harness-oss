// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRowLeaving } from './use-row-leaving'

describe('useRowLeaving', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('印を付けて150ms後に外して終わりの処理を呼ぶ', () => {
    const finish = vi.fn()
    const { result } = renderHook(() => useRowLeaving())
    expect(result.current.leavingId).toBeNull()
    act(() => {
      result.current.leave('row-1', finish)
    })
    expect(result.current.leavingId).toBe('row-1')
    expect(finish).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(result.current.leavingId).toBeNull()
    expect(finish).toHaveBeenCalledTimes(1)
  })

  it('続けてもう一度呼ぶと前の待ちは捨てる', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result } = renderHook(() => useRowLeaving())
    act(() => {
      result.current.leave('row-1', first)
    })
    act(() => {
      vi.advanceTimersByTime(100)
      result.current.leave('row-2', second)
    })
    expect(result.current.leavingId).toBe('row-2')
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
