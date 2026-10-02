// @vitest-environment happy-dom
/* 保存の知らせ（Toast）。★V7 共通部品その2 §2。右下・4秒・role=status。 */
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ToastHost, { clearToastsForTest, notifyToast, Toast } from './toast'

beforeEach(() => {
  clearToastsForTest()
  vi.useRealTimers()
})

afterEach(() => {
  cleanup()
  clearToastsForTest()
  vi.useRealTimers()
})

describe('保存の知らせ（Toast）', () => {
  it('notifyToast で右下の置き場所に出る（role=status）', () => {
    const { container } = render(<ToastHost />)
    act(() => {
      notifyToast('タグを保存しました')
    })
    const status = container.querySelector('[role="status"]')!
    expect(status.textContent).toContain('タグを保存しました')
  })

  it('4秒で消える', () => {
    vi.useFakeTimers()
    const { container } = render(<ToastHost />)
    act(() => {
      notifyToast('タグを保存しました')
    })
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('できなかった知らせも同じ置き場所に出る', () => {
    const { container } = render(<ToastHost />)
    act(() => {
      notifyToast('保存できませんでした。もう一度お試しください', { tone: 'error' })
    })
    expect(container.querySelector('[role="status"]')!.textContent).toContain('保存できませんでした')
  })

  it('取り消せる操作は「元に戻す」を1つ付ける', () => {
    const onAction = vi.fn()
    const onDismiss = vi.fn()
    const { container } = render(
      <Toast
        item={{ message: 'タグを保存しました', tone: 'success', actionLabel: '元に戻す', onAction }}
        onDismiss={onDismiss}
      />,
    )
    const button = container.querySelector('button')!
    expect(button.textContent).toBe('元に戻す')
    ;(button as HTMLButtonElement).click()
    expect(onAction).toHaveBeenCalledTimes(1)
    // 押したら知らせ自体も消える
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('3件までに絞る（古いものから捨てる）', () => {
    const { container } = render(<ToastHost />)
    act(() => {
      notifyToast('1件目')
      notifyToast('2件目')
      notifyToast('3件目')
      notifyToast('4件目')
    })
    const bodies = [...container.querySelectorAll('[role="status"]')].map((el) => el.textContent)
    expect(bodies).toHaveLength(3)
    expect(bodies.join('')).not.toContain('1件目')
    expect(bodies.join('')).toContain('4件目')
  })
})

describe('元に戻す（★V7 sTJsh §4）', () => {
  it('「元に戻す」付きは5秒残る（通常の4秒より長い）', () => {
    vi.useFakeTimers()
    const { container } = render(<ToastHost />)
    act(() => {
      notifyToast('外しました', { actionLabel: '元に戻す', onAction: vi.fn() })
    })
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('マウスを乗せている間は消えるまでの時間が止まる', () => {
    vi.useFakeTimers()
    const { container } = render(<ToastHost />)
    act(() => {
      notifyToast('外しました', { actionLabel: '元に戻す', onAction: vi.fn() })
    })
    const status = container.querySelector('[role="status"]')!
    act(() => {
      vi.advanceTimersByTime(2000)
      fireEvent.pointerEnter(status)
      // 乗せたまま5秒以上置いても消えない
      vi.advanceTimersByTime(6000)
    })
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    act(() => {
      fireEvent.pointerLeave(status)
      // 残りの3秒で消える
      vi.advanceTimersByTime(2999)
    })
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('⌘Z で直前の「元に戻す」を実行する', () => {
    const onAction = vi.fn()
    const { container } = render(<ToastHost />)
    act(() => {
      notifyToast('外しました', { actionLabel: '元に戻す', onAction })
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))
    })
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('⌘Z は一番新しい「元に戻す」だけに効く', () => {
    const first = vi.fn()
    const second = vi.fn()
    render(<ToastHost />)
    act(() => {
      notifyToast('1件目', { actionLabel: '元に戻す', onAction: first })
      notifyToast('2件目', { actionLabel: '元に戻す', onAction: second })
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))
    })
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('戻せる知らせが無いとき ⌘Z は何もしない', () => {
    const { container } = render(<ToastHost />)
    act(() => {
      notifyToast('保存しました')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))
    })
    // 知らせは残り、取り消しも起きない
    expect(container.querySelector('[role="status"]')).not.toBeNull()
  })

  it('入力欄の中では ⌘Z は文字の取り消しに譲る', () => {
    const onAction = vi.fn()
    const { container } = render(
      <div>
        <input aria-label="欄" />
        <ToastHost />
      </div>,
    )
    act(() => {
      notifyToast('外しました', { actionLabel: '元に戻す', onAction })
    })
    const input = container.querySelector('input')!
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))
    })
    expect(onAction).not.toHaveBeenCalled()
    expect(container.querySelector('[role="status"]')).not.toBeNull()
  })
})
