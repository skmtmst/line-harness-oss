// @vitest-environment happy-dom
/*
 * 見出し・ラベル横の「？」を本物の React で動かす試験。
 * 閉じている時はボタンだけ。開くと補足が出て、もう一度押すと閉じる。
 */
import React from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import HelpTip from './help-tip'

afterEach(() => cleanup())

describe('HelpTip', () => {
  test('閉じている時はボタンだけで補足は出ない', () => {
    render(<HelpTip label="検査の状態の意味">確かめています、の意味</HelpTip>)
    expect(screen.getByRole('button', { name: '検査の状態の意味' })).toBeTruthy()
    expect(screen.queryByText('確かめています、の意味')).toBeNull()
  })

  test('押すと補足が出て、読み上げの結び付きが付く', () => {
    render(<HelpTip label="検査の状態の意味">確かめています、の意味</HelpTip>)
    const button = screen.getByRole('button', { name: '検査の状態の意味' })
    fireEvent.click(button)
    expect(screen.getByText('確かめています、の意味')).toBeTruthy()
    const described = button.getAttribute('aria-describedby')
    expect(described).toBeTruthy()
    expect(document.getElementById(described ?? '')?.textContent).toContain('確かめています')
  })

  test('もう一度押すと閉じる', () => {
    render(<HelpTip label="検査の状態の意味">確かめています、の意味</HelpTip>)
    const button = screen.getByRole('button', { name: '検査の状態の意味' })
    fireEvent.click(button)
    expect(screen.queryByText('確かめています、の意味')).toBeTruthy()
    fireEvent.click(button)
    expect(screen.queryByText('確かめています、の意味')).toBeNull()
  })
})
