// @vitest-environment happy-dom
/*
 * R623/R624 の結合再現（Toast + runUndoable/runOptimistic）。
 * fake timers + stub commit で、実APIを叩かずに画面と保存の一致を見る。
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ToastHost, { clearToastsForTest, undoLatestToast } from '@/components/shared/toast'
import { runOptimistic, runUndoable } from './undoable'

beforeEach(() => {
  clearToastsForTest()
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  clearToastsForTest()
  vi.useRealTimers()
})

function undoButton(container: HTMLElement): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((el) => el.textContent === '元に戻す')
  if (!found) throw new Error('元に戻すボタンがありません')
  return found as HTMLButtonElement
}

describe('R623 通知のhoverと送信期限は一つの期限', () => {
  it('hover中はcommitも止まる（8秒たっても送らない）', async () => {
    const commit = vi.fn().mockResolvedValue({ success: true })
    const { container } = render(<ToastHost />)
    act(() => {
      runUndoable({ message: '外しました', commit, undo: vi.fn() })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    const status = container.querySelector('[role="status"]')!
    act(() => {
      fireEvent.pointerEnter(status)
    })
    // 乗せたまま合計8秒（期限5秒超）。通知も送信も止まる。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(commit).not.toHaveBeenCalled()
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    // 離したら残り3秒で送る
    act(() => {
      fireEvent.pointerLeave(status)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999)
    })
    expect(commit).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('hoverで延びた期限内の元に戻すはcommitを止める（画面と保存が一致）', async () => {
    const commit = vi.fn().mockResolvedValue({ success: true })
    const undo = vi.fn()
    const { container } = render(<ToastHost />)
    act(() => {
      runUndoable({ message: '外しました', commit, undo })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    act(() => {
      fireEvent.pointerEnter(container.querySelector('[role="status"]')!)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    act(() => {
      undoButton(container).click()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    // 戻したら送らない。画面true・保存falseの不一致は起きない。
    expect(undo).toHaveBeenCalledTimes(1)
    expect(commit).not.toHaveBeenCalled()
  })

  it('commit後は⌘Zも元に戻すも効かない', async () => {
    const commit = vi.fn().mockResolvedValue({ success: true })
    const undo = vi.fn()
    const { container } = render(<ToastHost />)
    act(() => {
      runUndoable({ message: '外しました', commit, undo })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(commit).toHaveBeenCalledTimes(1)
    // 知らせは消え、遅れて届いた取り消しは画面だけ戻さない
    expect(undoLatestToast()).toBe(false)
    expect(undo).not.toHaveBeenCalled()
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})

describe('R624 ⌘Zは再試行ではなく元に戻す', () => {
  it('元に戻すの後のもう一度通知でも⌘Zは元に戻すだけ', async () => {
    const undo = vi.fn()
    const retry = vi.fn()
    render(<ToastHost />)
    act(() => {
      runUndoable({ message: '外しました', commit: vi.fn().mockResolvedValue({ success: true }), undo })
    })
    await act(async () => {
      runOptimistic({
        request: vi.fn().mockResolvedValue({ success: false, error: 'x' }),
        revert: vi.fn(),
        failureMessage: '付けられませんでした。',
        retry,
      })
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))
    })
    expect(retry).not.toHaveBeenCalled()
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('もう一度だけのとき⌘Zは何もしない（クリックの再試行は残す）', async () => {
    const retry = vi.fn()
    const { container } = render(<ToastHost />)
    await act(async () => {
      runOptimistic({
        request: vi.fn().mockResolvedValue({ success: false, error: 'x' }),
        revert: vi.fn(),
        failureMessage: '付けられませんでした。',
        retry,
      })
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))
    })
    expect(retry).not.toHaveBeenCalled()
    // 知らせは残る
    expect(container.textContent).toContain('付けられませんでした。')
    // 押しての再試行はできるまま
    const retryButton = [...container.querySelectorAll('button')].find(
      (el) => el.textContent === 'もう一度',
    ) as HTMLButtonElement
    act(() => {
      retryButton.click()
    })
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
