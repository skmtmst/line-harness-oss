// @vitest-environment happy-dom
/* 見出し横の「？」（V6共通 2-1b）。押す・Tab+Enterで開き、Esc・外で閉じる。 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import HelpTip from './help-tip'

afterEach(() => cleanup())

describe('HelpTip', () => {
  it('押すと吹き出しが出て、もう一度押すと閉じる', () => {
    render(<HelpTip label="使っている版の説明" text="利用先が使い始めたときの版です。" />)
    const button = screen.getByRole('button', { name: '使っている版の説明' })
    expect(screen.queryByText('利用先が使い始めたときの版です。')).toBeNull()
    fireEvent.click(button)
    expect(screen.getByText('利用先が使い始めたときの版です。')).toBeTruthy()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(button)
    expect(screen.queryByText('利用先が使い始めたときの版です。')).toBeNull()
  })

  it('素のbuttonで、Tabで focus が当たる（Enter は OS が押下に変える）', () => {
    render(<HelpTip label="使っている版の説明" text="利用先が使い始めたときの版です。" />)
    const button = screen.getByRole('button', { name: '使っている版の説明' })
    expect(button.tagName).toBe('BUTTON')
    ;(button as HTMLButtonElement).focus()
    expect(document.activeElement).toBe(button)
  })

  it('Escで閉じる', () => {
    render(<HelpTip label="使っている版の説明" text="利用先が使い始めたときの版です。" />)
    fireEvent.click(screen.getByRole('button', { name: '使っている版の説明' }))
    expect(screen.getByText('利用先が使い始めたときの版です。')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('利用先が使い始めたときの版です。')).toBeNull()
  })

  it('1つ開くと他は閉じる', () => {
    render(
      <>
        <HelpTip label="一つ目の説明" text="一つ目の本文" />
        <HelpTip label="二つ目の説明" text="二つ目の本文" />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: '一つ目の説明' }))
    expect(screen.getByText('一つ目の本文')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '二つ目の説明' }))
    expect(screen.queryByText('一つ目の本文')).toBeNull()
    expect(screen.getByText('二つ目の本文')).toBeTruthy()
  })

  it('開いたときだけ吹き出しとつながる（aria-describedby）', () => {
    render(<HelpTip label="使っている版の説明" text="利用先が使い始めたときの版です。" />)
    const button = screen.getByRole('button', { name: '使っている版の説明' })
    expect(button.getAttribute('aria-describedby')).toBeNull()
    fireEvent.click(button)
    const describedBy = button.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)).toBeTruthy()
  })
})
