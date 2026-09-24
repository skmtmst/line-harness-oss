// @vitest-environment happy-dom
/*
 * 複数選択（★V7 `WUVcz` §2）。
 * 札・+N・選んでも閉じない・Backspace で最後の札を外す、までを見る。
 */
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MultiSelect from './multi-select'
import type { MultiSelectOption } from './multi-select'

afterEach(() => cleanup())

const OPTIONS: MultiSelectOption[] = [
  { value: 'nen', label: 'NEN会員', dot: 'green' },
  { value: 'regular', label: '定期便', dot: 'blue' },
  { value: 'proposal', label: '定期便提案対象' },
  { value: 'cancel', label: '定期便解約' },
  { value: 'gift', label: 'ギフト' },
]

function Harness({ initial = ['nen', 'regular'], ...rest }: Partial<React.ComponentProps<typeof MultiSelect>> & { initial?: string[] }) {
  const [values, setValues] = useState(initial)
  return (
    <>
      <MultiSelect aria-label="タグ" options={OPTIONS} values={values} onChange={setValues} placeholder="タグを選ぶ" {...rest} />
      <span data-testid="values">{values.join(',')}</span>
    </>
  )
}

describe('複数選択（★V7 WUVcz）', () => {
  it('札で並べ、入り切らない分は「+N」', () => {
    render(<Harness initial={['nen', 'regular', 'proposal', 'cancel', 'gift']} maxChips={2} />)
    expect(screen.getByText('NEN会員')).toBeTruthy()
    expect(screen.getByText('定期便')).toBeTruthy()
    expect(screen.getByRole('button', { name: '残り3件を表示' }).textContent).toBe('+3')
  })

  it('開くと「N件選択中」「すべて外す」。外しても閉じない', () => {
    render(<Harness />)
    fireEvent.focus(screen.getByRole('combobox', { name: 'タグ' }))
    expect(screen.getByText('2件選択中')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'すべて外す' }))
    expect(screen.getByTestId('values').textContent).toBe('')
    // 開いたまま
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(screen.getByText('0件選択中')).toBeTruthy()
  })

  it('行を選んでも閉じない。各行の頭は共通 Checkbox', () => {
    render(<Harness initial={[]} />)
    const field = screen.getByRole('combobox', { name: 'タグ' })
    fireEvent.focus(field)
    const listbox = screen.getByRole('listbox')
    // 見た目の印は本物の checkbox（行が押すので印自体に焦点は当てない）
    const checks = within(listbox).getAllByRole('checkbox', { hidden: true })
    expect(checks).toHaveLength(5)
    fireEvent.click(within(listbox).getByRole('option', { name: /定期便提案対象/ }))
    expect(screen.getByTestId('values').textContent).toBe('proposal')
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /定期便提案対象/ }))
    expect(screen.getByTestId('values').textContent).toBe('')
    expect(screen.getByRole('listbox')).toBeTruthy()
  })

  it('札の×はその札だけ外す', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '「NEN会員」を外す' }))
    expect(screen.getByTestId('values').textContent).toBe('regular')
  })

  it('空の欄で Backspace を押すと最後の札を外す', () => {
    render(<Harness />)
    const field = screen.getByRole('combobox', { name: 'タグ' }) as HTMLInputElement
    field.focus()
    expect(field.value).toBe('')
    fireEvent.keyDown(field, { key: 'Backspace' })
    expect(screen.getByTestId('values').textContent).toBe('nen')
  })

  it('Esc で閉じても打った文字は残る', () => {
    render(<Harness initial={[]} />)
    const field = screen.getByRole('combobox', { name: 'タグ' }) as HTMLInputElement
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '定期' } })
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(field.value).toBe('定期')
  })

  it('「＋ 新しく作る」を押すと打った文字が渡り、欄が空に戻る', () => {
    const onCreate = vi.fn()
    render(<Harness initial={[]} onCreate={onCreate} />)
    const field = screen.getByRole('combobox', { name: 'タグ' }) as HTMLInputElement
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '紹介' } })
    fireEvent.click(screen.getByRole('button', { name: '「紹介」を新しく作る' }))
    expect(onCreate).toHaveBeenCalledWith('紹介')
    expect(field.value).toBe('')
  })

  it('誤りは下に何をすれば通るかを出す', () => {
    render(<Harness initial={[]} error="配信先のタグを1つ以上選んでください" />)
    const field = screen.getByRole('combobox', { name: 'タグ' })
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe('配信先のタグを1つ以上選んでください')
  })
})
