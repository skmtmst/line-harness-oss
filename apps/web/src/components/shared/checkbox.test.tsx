// @vitest-environment happy-dom
/*
 * ★管理画面 共通 チェックボックス（gvjpx）。
 * 本物の input を使うので、押す・Space・読み上げはブラウザの標準のまま。
 */
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Checkbox, { SettingCheckbox } from './checkbox'

afterEach(() => cleanup())

function Harness({ initial = false }: { initial?: boolean }) {
  const [checked, setChecked] = useState(initial)
  return <Checkbox checked={checked} onCheckedChange={setChecked}>すべての友だちに送る</Checkbox>
}

describe("チェックボックス", () => {
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

  it('押せる24pxは札のpaddingで受け、inputは箱からはみ出さない（M3報告のはみ出し対応）', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'checkbox.module.css'), 'utf8')
    // input は 18px の箱に収める（負の inset で外へ出さない）。
    expect(css).toMatch(/\.input \{\s*position:\s*absolute;\s*inset:\s*0;/s)
    // 24px の当たりは札（.line）の padding＋戻し margin で持つ。
    expect(css).toMatch(/\.line \{[^}]*padding:\s*3px;[^}]*margin:\s*-3px;/s)
  })
})


describe('固定の設定の理由と通常の切り替え', () => {
  it('常にオンの項目は値と理由を保ち、押しても外れない', () => {
    const changes: boolean[] = []
    render(<SettingCheckbox checked={false} locked label="URLを短縮して数える" onChange={(value) => changes.push(value)} />)
    const box = screen.getByRole('checkbox', { name: 'URLを短縮して数える' }) as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(true)
    expect(box.title).toBe('この設定は常にオンです')
    expect(box.getAttribute('aria-description')).toBe('この設定は常にオンです')
    fireEvent.click(box)
    expect(changes).toEqual([])
  })
  it('通常の項目には固定の理由を付けず、選んだ値を通知する', () => {
    const changes: boolean[] = []
    render(<SettingCheckbox checked={false} label="抽選する" onChange={(value) => changes.push(value)} />)
    const box = screen.getByRole('checkbox', { name: '抽選する' }) as HTMLInputElement
    expect(box.disabled).toBe(false)
    expect(box.hasAttribute('title')).toBe(false)
    expect(box.hasAttribute('aria-description')).toBe(false)
    fireEvent.click(box)
    expect(changes).toEqual([true])
  })
})
