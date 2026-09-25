// @vitest-environment happy-dom
/*
 * 補足の「？」（`docs/v6-common-rules.md` §2-1b）。
 * 押して開く・Escと外押しで閉じる・読み上げ名を持つことだけを見る。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import HelpTip from './help-tip'

afterEach(() => cleanup())

describe('補足の「？」', () => {
  it('押すまで中身は出さない。押すと出る', () => {
    render(<HelpTip label="送る日時の説明" text="入力した日時は日本時間です。" />)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '送る日時の説明' }))
    expect(screen.getByRole('tooltip').textContent).toBe('入力した日時は日本時間です。')
  })

  it('Escで閉じる。もう一度押しても閉じる', () => {
    render(<HelpTip label="送る日時の説明" text="入力した日時は日本時間です。" />)
    const trigger = screen.getByRole('button', { name: '送る日時の説明' })
    fireEvent.click(trigger)
    expect(screen.queryByRole('tooltip')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('外を押すと閉じる', () => {
    render(
      <>
        <HelpTip label="送る日時の説明" text="入力した日時は日本時間です。" />
        <button type="button">外</button>
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: '送る日時の説明' }))
    expect(screen.queryByRole('tooltip')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
