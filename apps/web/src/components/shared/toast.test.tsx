// @vitest-environment happy-dom
/*
 * 保存の知らせ（Toast）。★V7 共通部品その2 §2。右下・4秒。
 * 読み上げは置き場所の入れ物（role=status「知らせ」）が最初から受け持ち、
 * 1件ずつは role を持たない（動きの点検 14 番）。知らせは文で探す。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

/** 読み上げの入れ物（置き場所）。 */
const host = () => screen.getByRole('status', { name: '知らせ' })
/** 文で知らせ1件を探す（1件の箱を返す）。 */
const toastByText = (text: string | RegExp) => {
  const node = within(host()).queryByText(text)
  return node ? (node.closest('[data-toast]') as HTMLElement) : null
}

describe('保存の知らせ（Toast）', () => {
  it('notifyToast で右下の置き場所に出る（role=status）', () => {
    render(<ToastHost />)
    act(() => {
      notifyToast('タグを保存しました')
    })
    expect(within(host()).getByText('タグを保存しました')).toBeTruthy()
  })

  it('4秒で消える', () => {
    vi.useFakeTimers()
    render(<ToastHost />)
    act(() => {
      notifyToast('タグを保存しました')
    })
    expect(toastByText('タグを保存しました')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(toastByText('タグを保存しました')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(toastByText('タグを保存しました')).toBeNull()
  })

  it('できなかった知らせも同じ置き場所に出る', () => {
    render(<ToastHost />)
    act(() => {
      notifyToast('保存できませんでした。もう一度お試しください', { tone: 'error' })
    })
    expect(within(host()).getByText(/保存できませんでした/)).toBeTruthy()
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
    render(<ToastHost />)
    act(() => {
      notifyToast('1件目')
      notifyToast('2件目')
      notifyToast('3件目')
      notifyToast('4件目')
    })
    const bodies = within(host()).getAllByText(/件目$/).map((el) => el.textContent)
    expect(bodies).toEqual(['2件目', '3件目', '4件目'])
  })
})

describe('元に戻す（★V7 sTJsh §4）', () => {
  it('「元に戻す」付きは5秒残る（通常の4秒より長い）', () => {
    vi.useFakeTimers()
    render(<ToastHost />)
    act(() => {
      notifyToast('外しました', { actionLabel: '元に戻す', onAction: vi.fn() })
    })
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(toastByText('外しました')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(toastByText('外しました')).toBeNull()
  })

  it('マウスを乗せている間は消えるまでの時間が止まる', () => {
    vi.useFakeTimers()
    render(<ToastHost />)
    act(() => {
      notifyToast('外しました', { actionLabel: '元に戻す', onAction: vi.fn() })
    })
    const status = toastByText('外しました')!
    act(() => {
      vi.advanceTimersByTime(2000)
      fireEvent.pointerEnter(status)
      // 乗せたまま5秒以上置いても消えない
      vi.advanceTimersByTime(6000)
    })
    expect(toastByText('外しました')).not.toBeNull()
    act(() => {
      fireEvent.pointerLeave(status)
      // 残りの3秒で消える
      vi.advanceTimersByTime(2999)
    })
    expect(toastByText('外しました')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(toastByText('外しました')).toBeNull()
  })

  it('⌘Z で直前の「元に戻す」を実行する', () => {
    const onAction = vi.fn()
    render(<ToastHost />)
    act(() => {
      notifyToast('外しました', { actionLabel: '元に戻す', onAction })
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))
    })
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(toastByText('外しました')).toBeNull()
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
    render(<ToastHost />)
    act(() => {
      notifyToast('保存しました')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))
    })
    // 知らせは残り、取り消しも起きない
    expect(toastByText('保存しました')).not.toBeNull()
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
    expect(toastByText('外しました')).not.toBeNull()
  })
})

describe('読み上げの入れ物（動きの点検 14 番）', () => {
  it('知らせが無いときも入れ物（role=status・aria-live=polite）を最初から置く', () => {
    render(<ToastHost />)
    const region = host()
    expect(region.getAttribute('aria-live')).toBe('polite')
    // 足された1件だけを読む（全体を読み直さない）
    expect(region.getAttribute('aria-atomic')).toBe('false')
    expect(region.children).toHaveLength(0)
  })

  it('1件ずつには role・aria-live を付けない（入れ物と二重に読まない）', () => {
    render(<ToastHost />)
    act(() => {
      notifyToast('タグを保存しました')
    })
    const item = toastByText('タグを保存しました')!
    expect(item.getAttribute('role')).toBeNull()
    expect(item.getAttribute('aria-live')).toBeNull()
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })
})

describe('消えるときの動き（動きの点検 13 番）', () => {
  const setReduced = (reduce: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches: reduce && query.includes('reduce'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    document.documentElement.dataset.theme = 'v8'
  })

  afterEach(() => {
    delete document.documentElement.dataset.theme
    window.matchMedia = originalMatchMedia
  })

  it('V8 では消えかけ（data-closing）を --motion-exit ぶん見せてから外す', () => {
    setReduced(false)
    vi.useFakeTimers()
    render(<ToastHost />)
    act(() => {
      notifyToast('タグを保存しました')
    })
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    const leaving = toastByText('タグを保存しました')!
    expect(leaving).not.toBeNull()
    expect(leaving.hasAttribute('data-closing')).toBe(true)
    // 消えかけは読み上げ・押す対象から外す
    expect(leaving.getAttribute('aria-hidden')).toBe('true')
    act(() => {
      vi.advanceTimersByTime(149)
    })
    expect(toastByText('タグを保存しました')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(toastByText('タグを保存しました')).toBeNull()
  })

  it('続けて消えても、先の1件は自分の期限で外れる', () => {
    setReduced(false)
    vi.useFakeTimers()
    render(<ToastHost />)
    let first = () => {}
    let second = () => {}
    act(() => {
      first = notifyToast('1件目')
      second = notifyToast('2件目')
    })
    act(() => first())
    act(() => {
      vi.advanceTimersByTime(100)
    })
    act(() => second())
    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(toastByText('1件目')).toBeNull()
    expect(toastByText('2件目')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(toastByText('2件目')).toBeNull()
  })

  it('動きを減らす設定ではすぐ消える', () => {
    setReduced(true)
    render(<ToastHost />)
    let dismiss = () => {}
    act(() => {
      dismiss = notifyToast('タグを保存しました')
    })
    act(() => dismiss())
    expect(toastByText('タグを保存しました')).toBeNull()
  })
})
