// @vitest-environment happy-dom
/*
 * ★V7 共通 認証コード入力（xHzFK）の動き。
 * 旧ログイン画面では、自動入力の6桁が1マス目にまとめて入り、最後の1桁しか残らなかった。
 */
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OtpInput from './otp-input'

afterEach(() => cleanup())

function Harness({ onComplete, initial = '' }: { onComplete?: (value: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <OtpInput value={value} onChange={setValue} onComplete={onComplete} label="認証コード" />
      <output data-testid="value">{value}</output>
    </>
  )
}

const slot = (n: number) => screen.getByLabelText(`${n}桁目`) as HTMLInputElement
const value = () => screen.getByTestId('value').textContent

describe('認証コード入力（★V7 xHzFK）', () => {
  it('数字を打つと入って次のマスへ移る。数字以外は入らない', () => {
    render(<Harness />)
    slot(1).focus()
    fireEvent.keyDown(slot(1), { key: '4' })
    expect(value()).toBe('4')
    expect(document.activeElement).toBe(slot(2))
    fireEvent.keyDown(slot(2), { key: 'a' })
    fireEvent.change(slot(2), { target: { value: 'x' } })
    expect(value()).toBe('4')
  })

  it('自動入力で1マス目に6桁まとめて入っても、6マスにそろう（旧画面は最後の1桁しか残らなかった）', () => {
    render(<Harness />)
    fireEvent.change(slot(1), { target: { value: '482917' } })
    expect(value()).toBe('482917')
    expect([1, 2, 3, 4, 5, 6].map((n) => slot(n).value).join('')).toBe('482917')
  })

  it('貼り付けは押した位置から振り分け、余りは捨てる。数字以外は除く', () => {
    render(<Harness initial="12" />)
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: { getData: () => string } }
    paste.clipboardData = { getData: () => '98-76 54' }
    act(() => { slot(3).dispatchEvent(paste) })
    expect(value()).toBe('129876')
  })

  it('同じ数字で上書きしても、次のマスへ移る', () => {
    render(<Harness initial="44" />)
    act(() => { slot(1).focus() })
    fireEvent.keyDown(slot(1), { key: '4' })
    expect(value()).toBe('44')
    expect(document.activeElement).toBe(slot(2))
  })

  it('空いたマスを押しても、次に入れるマスへ移る（左から詰める）', () => {
    render(<Harness initial="12" />)
    act(() => { slot(6).focus() })
    expect(document.activeElement).toBe(slot(3))
  })

  it('Backspace は空のマスなら前を消して戻り、数字のあるマスならそれを消す', () => {
    render(<Harness initial="123" />)
    act(() => { slot(4).focus() })
    fireEvent.keyDown(slot(4), { key: 'Backspace' })
    expect(value()).toBe('12')
    expect(document.activeElement).toBe(slot(3))
    act(() => { slot(1).focus() })
    fireEvent.keyDown(slot(1), { key: 'Backspace' })
    expect(value()).toBe('2')
  })

  it('←→ と Home・End で移動できる', () => {
    render(<Harness initial="1234" />)
    act(() => { slot(3).focus() })
    fireEvent.keyDown(slot(3), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(slot(2))
    fireEvent.keyDown(slot(2), { key: 'End' })
    expect(document.activeElement).toBe(slot(5))
    fireEvent.keyDown(slot(5), { key: 'Home' })
    expect(document.activeElement).toBe(slot(1))
  })

  it('6桁そろった瞬間に1回だけ知らせる', () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} initial="48291" />)
    act(() => { slot(6).focus() })
    fireEvent.keyDown(slot(6), { key: '7' })
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith('482917')
    fireEvent.keyDown(slot(6), { key: '8' })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('自動入力の印は1マス目だけ。6マスは1つのまとまりとして読み上げる', () => {
    render(<Harness />)
    expect(slot(1).getAttribute('autocomplete')).toBe('one-time-code')
    expect([2, 3, 4, 5, 6].every((n) => slot(n).getAttribute('autocomplete') === 'off')).toBe(true)
    expect(screen.getByRole('group', { name: '認証コード' })).toBeTruthy()
    expect(slot(1).getAttribute('inputmode')).toBe('numeric')
  })

  it('誤りのときは各マスに aria-invalid、無効のときは打てない', () => {
    const { rerender } = render(<OtpInput value="12" onChange={() => {}} invalid label="認証コード" />)
    expect(slot(1).getAttribute('aria-invalid')).toBe('true')
    rerender(<OtpInput value="12" onChange={() => {}} disabled label="認証コード" />)
    expect(slot(1).disabled).toBe(true)
  })
})
