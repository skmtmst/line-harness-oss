// @vitest-environment happy-dom
/*
 * ★V7 共通 チェックボックス（gvjpx）。
 * 本物の input を使うので、押す・Space・読み上げはブラウザの標準のまま。
 */
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Checkbox from './checkbox'

afterEach(() => cleanup())

function Harness({ initial = false }: { initial?: boolean }) {
  const [checked, setChecked] = useState(initial)
  return <Checkbox checked={checked} onCheckedChange={setChecked}>すべての友だちに送る</Checkbox>
}

describe('チェックボックス（★V7 gvjpx）', () => {
  it('文字を押しても切り替わり、読み上げ名は文字になる', () => {
    render(<Harness />)
    const box = screen.getByRole('checkbox', { name: 'すべての友だちに送る' }) as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(screen.getByText('すべての友だちに送る'))
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    expect(box.checked).toBe(false)
  })

  it('一部選択は input の indeterminate に入る（属性では表せない）', () => {
    const { rerender } = render(<Checkbox checked={false} indeterminate onCheckedChange={() => {}} aria-label="表示中の友だちをすべて選ぶ" />)
    const box = screen.getByRole('checkbox', { name: '表示中の友だちをすべて選ぶ' }) as HTMLInputElement
    expect(box.indeterminate).toBe(true)
    rerender(<Checkbox checked indeterminate={false} onCheckedChange={() => {}} aria-label="表示中の友だちをすべて選ぶ" />)
    expect(box.indeterminate).toBe(false)
  })

  it('誤りの文は aria-describedby でつながり、aria-invalid が立つ', () => {
    render(<Checkbox checked={false} onCheckedChange={() => {}} error="同意しないと先へ進めません">利用規約に同意する</Checkbox>)
    const box = screen.getByRole('checkbox', { name: '利用規約に同意する' })
    expect(box.getAttribute('aria-invalid')).toBe('true')
    const note = document.getElementById(box.getAttribute('aria-describedby') ?? '')
    expect(note?.textContent).toBe('同意しないと先へ進めません')
  })

  it('無効のときは押しても変わらない', () => {
    let changes = 0
    render(<Checkbox checked={false} disabled onCheckedChange={() => { changes += 1 }}>すべての友だちに送る</Checkbox>)
    fireEvent.click(screen.getByText('すべての友だちに送る'))
    expect(changes).toBe(0)
  })
})
