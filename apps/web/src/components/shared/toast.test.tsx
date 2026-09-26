// @vitest-environment happy-dom
/* 保存の知らせ（Toast）。★V7 共通部品その2 §2。右下・4秒・role=status。 */
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
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
