// @vitest-environment happy-dom
/*
 * 候補つき入力（★V7 `WUVcz` §1）。
 * 打って絞る・↑↓と Enter で選ぶ・Esc で閉じても文字は残す、までを見る。
 */
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Combobox from './combobox'
import type { ComboboxOption } from './combobox'

afterEach(() => cleanup())

const OPTIONS: ComboboxOption[] = [
  { value: 'prev-day', label: '予約前日のご案内', hint: 'テキスト' },
  { value: 'prev-hour', label: '予約1時間前のご案内', hint: 'テキスト' },
  { value: 'change', label: '予約変更のお知らせ', hint: 'カード' },
]

function Harness({ options = OPTIONS, ...rest }: Partial<React.ComponentProps<typeof Combobox>> & { options?: ComboboxOption[] }) {
  const [value, setValue] = useState('')
  return (
    <>
      <Combobox aria-label="テンプレート" options={options} value={value} onChange={setValue} placeholder="テンプレートを選ぶ" {...rest} />
      <span data-testid="value">{value}</span>
    </>
  )
}

describe('候補つき入力（★V7 WUVcz）', () => {
  it('打つと絞られ、一致した所が太字、件数が読み上げに渡る', () => {
    render(<Harness />)
    const field = screen.getByRole('combobox', { name: 'テンプレート' })
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '予約' } })
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getAllByRole('option')).toHaveLength(3)
    fireEvent.change(field, { target: { value: '変更' } })
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option').querySelector('strong')?.textContent).toBe('変更')
    expect(screen.getByRole('status').textContent).toBe('1件の候補')
  })

  it('↓と Enter で選ぶと閉じて値が入る。焦点は欄に残る', () => {
    render(<Harness />)
    const field = screen.getByRole('combobox', { name: 'テンプレート' })
    field.focus()
    fireEvent.change(field, { target: { value: '予約' } })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(screen.getByTestId('value').textContent).toBe('prev-hour')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(field)
  })

  it('Esc で閉じても打った文字は残る', () => {
    render(<Harness />)
    const field = screen.getByRole('combobox', { name: 'テンプレート' }) as HTMLInputElement
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '予約' } })
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(field.value).toBe('予約')
  })

  it('合う候補がないときは探した文字を書く。作る行は頼まれたときだけ', () => {
    render(<Harness />)
    const field = screen.getByRole('combobox', { name: 'テンプレート' })
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'ギフト' } })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByText('「ギフト」に合う候補はありません')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /新しく作る/ })).toBeNull()
  })

  it('「＋ 新しく作る」を押すと打った文字が渡る', () => {
    const onCreate = vi.fn()
    render(<Harness onCreate={onCreate} />)
    const field = screen.getByRole('combobox', { name: 'テンプレート' })
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'ギフト' } })
    fireEvent.click(screen.getByRole('button', { name: '「ギフト」を新しく作る' }))
    expect(onCreate).toHaveBeenCalledWith('ギフト')
  })

  it('読み込み中は候補の場所を空けたまま「探しています…」', () => {
    render(<Harness loading />)
    fireEvent.focus(screen.getByRole('combobox', { name: 'テンプレート' }))
    expect(screen.getByText('探しています…')).toBeTruthy()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('探しています')
  })

  it('誤りは欄が無効と読まれ、下に何をすれば通るかを出す', () => {
    render(<Harness error="テンプレートを1つ選んでください" />)
    const field = screen.getByRole('combobox', { name: 'テンプレート' })
    expect(field.getAttribute('aria-invalid')).toBe('true')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('テンプレートを1つ選んでください')
    expect(field.getAttribute('aria-describedby')).toBe(alert.getAttribute('id'))
  })

  it('×で消すと空になって一覧が開く', () => {
    render(<Harness />)
    const field = screen.getByRole('combobox', { name: 'テンプレート' }) as HTMLInputElement
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '予約' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(field.value).toBe('予約前日のご案内')
    fireEvent.click(screen.getByRole('button', { name: '入力を消す' }))
    expect(field.value).toBe('')
    expect(screen.getByTestId('value').textContent).toBe('')
    expect(screen.getByRole('listbox')).toBeTruthy()
  })
})
