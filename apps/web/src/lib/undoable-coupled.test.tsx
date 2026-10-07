// @vitest-environment happy-dom
/*
 * R623/R624 の結合再現（Toast + runUndoable/runOptimistic）。
 * fake timers + stub commit で、実APIを叩かずに画面と保存の一致を見る。
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ToastHost, { clearToastsForTest, notifyToast, undoLatestToast } from '@/components/shared/toast'
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

/*
 * 知らせは置き場所の読み上げの入れ物（role=status「知らせ」）の中にあり、
 * 1件ずつは role を持たない（動きの点検 14 番）。文で1件の箱を探す。
 */
function toastBox(text: string): HTMLElement | null {
  const node = within(screen.getByRole('status', { name: '知らせ' })).queryByText(text)
  return node ? (node.closest('[data-toast]') as HTMLElement) : null
}

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
    const status = toastBox('外しました')!
    act(() => {
      fireEvent.pointerEnter(status)
    })
    // 乗せたまま合計8秒（期限5秒超）。通知も送信も止まる。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(commit).not.toHaveBeenCalled()
    expect(toastBox('外しました')).not.toBeNull()
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
      fireEvent.pointerEnter(toastBox('外しました')!)
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
    expect(toastBox('外しました')).toBeNull()
  })
})

describe('R623b 消えた通知の未取消の保存は残り時間で必ず一度だけ送る', () => {
  it('hover中に×で閉じても残り時間で一度だけcommit', async () => {
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
      fireEvent.pointerEnter(toastBox('外しました')!)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    // 止まったまま×で閉じる（残り3秒）。取り消していないので送る。
    act(() => {
      ;(container.querySelector('button[aria-label="知らせを閉じる"]') as HTMLButtonElement).click()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999)
    })
    expect(commit).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(undo).not.toHaveBeenCalled()
    expect(undoLatestToast()).toBe(false)
  })

  it('hover中に4件目で押し出されても残り時間で一度だけcommit', async () => {
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
      fireEvent.pointerEnter(toastBox('外しました')!)
    })
    // 止まったまま4件目が来て押し出される（残り3秒）
    act(() => {
      notifyToast('a')
      notifyToast('b')
      notifyToast('c')
    })
    expect(container.textContent).not.toContain('外しました')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999)
    })
    expect(commit).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(undo).not.toHaveBeenCalled()
  })

  it('focus保持のままホストを外しても一度だけcommit', async () => {
    const commit = vi.fn().mockResolvedValue({ success: true })
    const undo = vi.fn()
    const { container, unmount } = render(<ToastHost />)
    act(() => {
      runUndoable({ message: '外しました', commit, undo })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    act(() => {
      fireEvent.focusIn(toastBox('外しました')!)
    })
    // 元の期限（5秒）を過ぎても止まったまま
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(commit).not.toHaveBeenCalled()
    // 画面遷移などでホストが外れる。未取消なので残り時間で送る。
    act(() => {
      unmount()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999)
    })
    expect(commit).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(undo).not.toHaveBeenCalled()
  })

  it('hoverとfocusの重なりは両方離すまで止まる', async () => {
    const commit = vi.fn().mockResolvedValue({ success: true })
    const { container } = render(<ToastHost />)
    act(() => {
      runUndoable({ message: '外しました', commit, undo: vi.fn() })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      fireEvent.pointerEnter(toastBox('外しました')!)
      fireEvent.focusIn(toastBox('外しました')!)
    })
    // 元の期限を過ぎても止まったまま
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(commit).not.toHaveBeenCalled()
    // マウスだけ離してもfocusが残っていれば止まったまま
    act(() => {
      fireEvent.pointerLeave(toastBox('外しました')!)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(commit).not.toHaveBeenCalled()
    // 両方離したら残り4秒で送る
    act(() => {
      fireEvent.focusOut(toastBox('外しました')!)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3999)
    })
    expect(commit).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(commit).toHaveBeenCalledTimes(1)
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
