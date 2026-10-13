// @vitest-environment happy-dom
import { createElement } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ActionRow } from '@/components/shared/action-list'

afterEach(cleanup)

describe('自動化作成の行の構造（#973 U023）', () => {
  it('名前と値は同じまとまり、設定欄は行の操作から独立して描く', () => {
    const { container } = render(createElement(ActionRow, {
      title: '本人にLINEで知らせる', kind: 'LINE', number: 1, open: true,
      onToggle: () => {}, extra: '成果1件ごとに',
    }, createElement('input', { 'aria-label': 'すること', defaultValue: 'LINEで知らせる' }),
    createElement('input', { 'aria-label': '対象', defaultValue: '付けるタグ' })))
    const row = container.querySelector('[data-action-row]')!
    const name = within(row as HTMLElement).getByRole('button', { name: '本人にLINEで知らせる' })
    const value = within(row as HTMLElement).getByText('成果1件ごとに')
    expect(name.parentElement).toBe(value.parentElement)
    const operation = screen.getByRole('button', { name: '1つ目の行うことのその他操作' })
    expect(name.parentElement?.contains(operation)).toBe(false)
    const inputs = screen.getAllByRole('textbox')
    expect(inputs.map(input => input.getAttribute('aria-label'))).toEqual(['すること', '対象'])
    expect(inputs[0].parentElement).toBe(inputs[1].parentElement)
    expect(inputs[0].parentElement?.parentElement).toBe(row)
    expect(inputs[0].parentElement?.contains(name)).toBe(false)
    expect((inputs[0] as HTMLInputElement).value).toBe('LINEで知らせる')
    expect((inputs[1] as HTMLInputElement).value).toBe('付けるタグ')
  })
})
