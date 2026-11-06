// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import PermissionLockedButton from './permission-locked-button'

afterEach(cleanup)

const REASON = '送り先は統括の担当者だけが作れます'

describe('権限で押せない作るボタン', () => {
  it('本物のボタンを押せない形で置き、理由を読み上げにつなぐ', () => {
    render(<PermissionLockedButton reason={REASON}>送り先を作る</PermissionLockedButton>)
    const button = screen.getByRole('button', { name: '送り先を作る' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    // 焦点を当てられるよう、ネイティブの disabled は使わない。
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe(REASON)
  })

  it('マウスを乗せると吹き出しが出て、離すと消える', () => {
    render(<PermissionLockedButton reason={REASON}>送り先を作る</PermissionLockedButton>)
    const button = screen.getByRole('button', { name: '送り先を作る' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.pointerEnter(button, { pointerType: 'mouse' })
    expect(screen.getByRole('tooltip').textContent).toBe(REASON)
    fireEvent.pointerLeave(button, { pointerType: 'mouse' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('キーボードで焦点を当てても出て、Esc と焦点が外れると消える', () => {
    render(<PermissionLockedButton reason={REASON}>送り先を作る</PermissionLockedButton>)
    const button = screen.getByRole('button', { name: '送り先を作る' })
    fireEvent.focus(button)
    expect(screen.getByRole('tooltip').textContent).toBe(REASON)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.focus(button)
    fireEvent.blur(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('タッチで押すと理由の吹き出しが出る', () => {
    render(<PermissionLockedButton reason={REASON}>送り先を作る</PermissionLockedButton>)
    const button = screen.getByRole('button', { name: '送り先を作る' })
    fireEvent.pointerDown(button, { pointerType: 'touch' })
    expect(screen.getByRole('tooltip').textContent).toBe(REASON)
    fireEvent.click(button)
    expect(screen.getByRole('tooltip').textContent).toBe(REASON)
  })

  it('押しても何も起きない（送信・移動を止める）', () => {
    const submit = vi.fn((event: Event) => event.preventDefault())
    render(<form onSubmit={submit as never}><PermissionLockedButton reason={REASON}>送り先を作る</PermissionLockedButton></form>)
    fireEvent.click(screen.getByRole('button', { name: '送り先を作る' }))
    expect(submit).not.toHaveBeenCalled()
  })
})
