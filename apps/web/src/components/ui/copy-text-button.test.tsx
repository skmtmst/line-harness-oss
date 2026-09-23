// @vitest-environment happy-dom
/*
 * CopyTextButton（監査6 #665）を本物のReactで動かす試験。
 *
 * 見るのは3点:
 *   - 押すと表示文字列ではなく渡された全文がクリップボードへ入る
 *   - 成功するとボタンが「コピー済み」へ変わり、一定時間で元に戻る
 *   - clipboard API が失敗する環境では、全文を選んでコピーできる
 *     読み取り専用の欄と一言を出す（省略表示のままでは取り出せないため）
 */
import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import CopyTextButton from './copy-text-button'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function stubClipboard(impl: (text: string) => Promise<void>) {
  const writeText = vi.fn(impl)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  return writeText
}

afterEach(() => {
  cleanup()
})

describe('CopyTextButton', () => {
  it('押すと全文をクリップボードへ書き、「コピー済み」へ変わる', async () => {
    const writeText = stubClipboard(async () => undefined)
    render(<CopyTextButton value="{{var.open_hours}}" aria-label="営業時間の差し込みキーをコピー" />)

    const button = screen.getByRole('button', { name: '営業時間の差し込みキーをコピー' })
    await act(async () => { fireEvent.click(button) })

    expect(writeText).toHaveBeenCalledWith('{{var.open_hours}}')
    expect(button.textContent).toBe('コピー済み')
    expect(button.title).toBe('コピーしました')
  })

  it('「コピー済み」は一定時間で「コピー」へ戻る', async () => {
    vi.useFakeTimers()
    try {
      stubClipboard(async () => undefined)
      render(<CopyTextButton value="abc" aria-label="値をコピー" />)

      const button = screen.getByRole('button', { name: '値をコピー' })
      await act(async () => { fireEvent.click(button) })
      expect(button.textContent).toBe('コピー済み')

      await act(async () => { vi.advanceTimersByTime(1600) })
      expect(button.textContent).toBe('コピー')
    } finally {
      vi.useRealTimers()
    }
  })

  it('コピーできない環境では全文を選べる欄と一言を出す', async () => {
    stubClipboard(async () => { throw new Error('denied') })
    render(<CopyTextButton value="{{var.very_long_key_name}}" aria-label="キーをコピー" />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'キーをコピー' })) })

    const field = screen.getByLabelText('キーをコピー') as HTMLInputElement
    expect(field.value).toBe('{{var.very_long_key_name}}')
    expect(field.readOnly).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('コピーできませんでした')
  })
})
