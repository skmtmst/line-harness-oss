// @vitest-environment happy-dom
/*
 * ★V8 B-26（A-2 採用）受信箱の右の欄でその場で直す：押した瞬間に変えて裏で保存し、
 * 通ったら［元に戻す］付きの白い知らせ（5秒・乗せている間は止まる）、失敗したら戻して
 * 理由と［もう一度試す］。共通の知らせ（ToastHost）で確かめる。
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'
import { runOptimisticWithUndo } from './undoable'
import { ApiError } from './api'

beforeEach(() => {
  clearToastsForTest()
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  clearToastsForTest()
  vi.useRealTimers()
})

const buttonByText = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((el) => el.textContent?.includes(text)) as HTMLButtonElement | undefined

describe('runOptimisticWithUndo（その場で直す）', () => {
  it('通ったら成功の文と［元に戻す］を出し、押すと画面を戻して逆の保存を送る', async () => {
    const request = vi.fn().mockResolvedValue({ success: true })
    const undoRequest = vi.fn().mockResolvedValue({ success: true })
    const revert = vi.fn()
    const { container } = render(<ToastHost />)
    await act(async () => {
      runOptimisticWithUndo({ request, revert, undoRequest, successMessage: '対応状況を「対応中」にしました', failureMessage: '対応状況を変えられませんでした。', retry: vi.fn() })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('対応状況を「対応中」にしました')
    const undo = buttonByText(container, '元に戻す')
    expect(undo).toBeTruthy()
    await act(async () => {
      undo!.click()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(revert).toHaveBeenCalledTimes(1)
    expect(undoRequest).toHaveBeenCalledTimes(1)
  })

  it('知らせは5秒で消える（元に戻す付き）', async () => {
    const { container } = render(<ToastHost />)
    await act(async () => {
      runOptimisticWithUndo({ request: vi.fn().mockResolvedValue({ success: true }), revert: vi.fn(), undoRequest: vi.fn(), successMessage: 'タグ「VIP」を付けました', failureMessage: 'x', retry: vi.fn() })
      await vi.advanceTimersByTimeAsync(4900)
    })
    expect(container.textContent).toContain('タグ「VIP」を付けました')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(container.textContent).not.toContain('タグ「VIP」を付けました')
  })

  it('失敗したら画面を戻し、口の理由と［もう一度試す］を出す。押すとやり直す', async () => {
    const revert = vi.fn()
    const retry = vi.fn()
    const { container } = render(<ToastHost />)
    await act(async () => {
      runOptimisticWithUndo({
        request: vi.fn().mockRejectedValue(new ApiError(400, '担当者が見つかりません')),
        revert, retry, successMessage: '担当をKentaにしました', failureMessage: '担当を変えられませんでした。',
      })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(revert).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('担当を変えられませんでした。担当者が見つかりません')
    expect(container.textContent).not.toContain('担当をKentaにしました')
    await act(async () => {
      buttonByText(container, 'もう一度試す')!.click()
    })
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('機械の文（API error: 500）は出さず、言い換える', async () => {
    const { container } = render(<ToastHost />)
    await act(async () => {
      runOptimisticWithUndo({ request: vi.fn().mockResolvedValue({ success: false, error: 'API error: 500' }), revert: vi.fn(), retry: vi.fn(), successMessage: 'ok', failureMessage: 'メモを保存できませんでした。' })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(container.textContent).toContain('メモを保存できませんでした。通信を確かめて')
    expect(container.textContent).not.toContain('API error')
  })

  it('元に戻す保存が失敗したら、画面をもう一度直して知らせる', async () => {
    const reapply = vi.fn()
    const { container } = render(<ToastHost />)
    await act(async () => {
      runOptimisticWithUndo({ request: vi.fn().mockResolvedValue({ success: true }), revert: vi.fn(), reapply, undoRequest: vi.fn().mockRejectedValue(new Error('x')), retry: vi.fn(), successMessage: '外しました', failureMessage: 'x' })
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      buttonByText(container, '元に戻す')!.click()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(reapply).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('元に戻せませんでした')
  })

  it('成功の文が空なら知らせない（v7 の画面は静かに終わる）', async () => {
    const onSuccess = vi.fn()
    const { container } = render(<ToastHost />)
    await act(async () => {
      runOptimisticWithUndo({ request: vi.fn().mockResolvedValue({ success: true }), revert: vi.fn(), undoRequest: vi.fn(), retry: vi.fn(), successMessage: '', failureMessage: 'x', onSuccess })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(buttonByText(container, '元に戻す')).toBeUndefined()
  })
})
