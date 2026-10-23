// @vitest-environment happy-dom
import { cleanup, act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRowLeaving } from './use-row-leaving'

describe('useRowLeaving', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
  })

  afterEach(async () => {
    // タイマーを戻す前に根を外し、hook が持つタイマーも片づける。
    await act(async () => cleanup())
    vi.useRealTimers()
    vi.unstubAllGlobals()
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

  it('動きを減らす設定では待たずに完了する', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const finish = vi.fn()
    const { result } = renderHook(() => useRowLeaving())
    act(() => result.current.leave('row-1', finish))
    expect(finish).toHaveBeenCalledOnce()
    expect(result.current.leavingIds).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('まとめて消すときは全部に印を付けてから外す', () => {
    const finish = vi.fn()
    const { result } = renderHook(() => useRowLeaving())
    act(() => {
      result.current.leaveMany(['row-1', 'row-2'], finish)
    })
    expect(result.current.isLeaving('row-1')).toBe(true)
    expect(result.current.isLeaving('row-2')).toBe(true)
    expect(result.current.isLeaving('row-3')).toBe(false)
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(result.current.isLeaving('row-1')).toBe(false)
    expect(finish).toHaveBeenCalledTimes(1)
  })

  it('別の行を続けて消しても先の完了と期限を保つ', () => {
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
    expect(result.current.leavingIds).toEqual(['row-1', 'row-2'])
    act(() => { vi.advanceTimersByTime(50) })
    expect(first).toHaveBeenCalledOnce()
    expect(result.current.leavingIds).toEqual(['row-2'])
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

it('消えている途中で動きを減らす設定へ変えると、完了を一度だけ即時に呼ぶ', () => {
  vi.useFakeTimers()
  const media = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal('matchMedia', () => media)
  const finish = vi.fn()
  const view = renderHook(() => useRowLeaving())
  try {
    act(() => view.result.current.leave('a', finish))
    act(() => { media.matches = true; media.dispatchEvent(new Event('change')) })
    expect(finish).toHaveBeenCalledOnce()
    expect(view.result.current.leavingIds).toEqual([])
    act(() => vi.advanceTimersByTime(150))
    expect(finish).toHaveBeenCalledOnce()
  } finally { view.unmount(); vi.useRealTimers(); vi.unstubAllGlobals() }
})
