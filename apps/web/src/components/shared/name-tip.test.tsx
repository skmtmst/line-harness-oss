// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NameTipHost, { isIconOnlyAction } from './name-tip'
import IconButton from './icon-button'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('アイコンだけのボタンの名前の吹き出し（2026-10-25）', () => {
  it('印だけのボタンに乗せると、aria-label と同じ文の吹き出しが 0.4 秒後に出て、離すと消える', () => {
    render(<><NameTipHost /><IconButton aria-label="もっと見る"><svg aria-hidden="true" /></IconButton></>)
    const button = screen.getByRole('button', { name: 'もっと見る' })
    fireEvent.pointerOver(button, { pointerType: 'mouse' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.getByRole('tooltip').textContent).toBe('もっと見る')
    expect(button.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
    fireEvent.pointerOut(button, { relatedTarget: document.body })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(button.getAttribute('aria-describedby')).toBeNull()
  })

  it('文字のあるボタンには出さない。押す・Esc で消え、同じ名前の title は出している間だけ外して戻す', () => {
    render(<><NameTipHost /><button type="button" aria-label="保存">保存</button><button type="button" aria-label="閉じる" title="閉じる"><svg aria-hidden="true" /></button></>)
    fireEvent.pointerOver(screen.getByRole('button', { name: '保存' }), { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    const close = screen.getByRole('button', { name: '閉じる' })
    fireEvent.pointerOver(close, { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.getByRole('tooltip').textContent).toBe('閉じる')
    expect(close.hasAttribute('title')).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(close.getAttribute('title')).toBe('閉じる')
    fireEvent.pointerOver(close, { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(400) })
    fireEvent.pointerDown(close)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('見える文字が無く aria-label を持つ物だけを相手にする', () => {
    const icon = document.createElement('button'); icon.setAttribute('aria-label', '削除')
    const text = document.createElement('button'); text.setAttribute('aria-label', '削除'); text.textContent = '削除'
    const off = document.createElement('div'); off.setAttribute('data-no-name-tip', ''); const inner = icon.cloneNode() as HTMLElement; off.append(inner)
    expect(isIconOnlyAction(icon)).toBe(true)
    expect(isIconOnlyAction(text)).toBe(false)
    expect(isIconOnlyAction(inner)).toBe(false)
  })
})
