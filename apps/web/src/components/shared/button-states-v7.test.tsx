// @vitest-environment happy-dom
/*
 * ★V7 仕上げ §2「ボタンは6つの状態を持つ。幅は変えない」。
 * 平常・乗せた・押したは CSS、保存中・完了・失敗は busy/done の
 * 見た目としてここで契約化する。
 * DOM に出す文字は常に今のラベル1つだけ（`textContent === 'ラベル'`
 * で探す呼び出し側が迷子にならない）。幅は平常時の実測値を
 * min-width に留める。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Button from './button'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ボタンの6状態（★V7 z97zZN §2）', () => {
  it('busy の間は回る印＋「保存中…」に見た目を切り替え、押せなくする', () => {
    render(<Button variant="primary" busy>保存する</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveProperty('disabled', true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    /* DOM の文字は今のラベルだけ。隠した文字は残さない。 */
    expect(button.textContent).toBe('保存中…')
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it('busyLabel は上書きできる', () => {
    render(<Button busy busyLabel="送信中…">送る</Button>)
    const button = screen.getByRole('button')
    expect(button.textContent).toBe('送信中…')
  })

  it('busy でないときは平常の字だけが出る', () => {
    render(<Button variant="primary" busy={false}>保存する</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveProperty('disabled', false)
    expect(button.getAttribute('aria-busy')).toBeNull()
    expect(button.textContent).toBe('保存する')
  })

  it('done は ✓＋「保存しました」を1.2秒だけ出して元の文字へ戻る', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Button variant="primary" busy={false} done={false}>保存する</Button>)
    const button = screen.getByRole('button')
    expect(button.textContent).toBe('保存する')

    rerender(<Button variant="primary" busy={false} done>保存する</Button>)
    expect(button.textContent).toBe('保存しました')

    act(() => {
      vi.advanceTimersByTime(1300)
    })
    expect(button.textContent).toBe('保存する')
  })

  it('doneLabel は上書きできる', () => {
    vi.useFakeTimers()
    render(<Button busy={false} done doneLabel="送信しました">送る</Button>)
    const button = screen.getByRole('button')
    expect(button.textContent).toBe('送信しました')
  })

  it('busy 中に done が来ても保存中を優先し、busy が終わってから完了を出す', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Button busy done={false}>保存する</Button>)
    const button = screen.getByRole('button')
    rerender(<Button busy done>保存する</Button>)
    expect(button.textContent).toBe('保存中…')
    rerender(<Button busy={false} done>保存する</Button>)
    expect(button.textContent).toBe('保存しました')
  })

  it('リンクボタンは busy/done を持たない（常に平常の字）', () => {
    render(<Button href="/settings">設定へ戻る</Button>)
    const link = screen.getByRole('link')
    expect(link.textContent).toBe('設定へ戻る')
  })
})
