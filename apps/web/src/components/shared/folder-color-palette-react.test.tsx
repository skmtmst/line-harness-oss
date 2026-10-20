// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import FolderColorButton from './folder-color-button'
import { readFileSync } from 'node:fs'
afterEach(cleanup)
const colors = [{ value: '#EF4B55', name: '赤' }, { value: '#2563D4', name: '青' }]
it('その場のパレットも名前と選択を読み上げ、矢印で色を変えて焦点を移す', () => {
  function Example() {
    const [value, setValue] = useState<string | null>('#EF4B55')
    return <FolderColorButton appearance="palette" label="マークの色" colors={colors} value={value} onChange={setValue} />
  }
  render(<Example />)
  expect(screen.getByRole('radiogroup', { name: 'マークの色' })).toBeTruthy()
  const red = screen.getByRole('radio', { name: '赤' })
  const blue = screen.getByRole('radio', { name: '青' })
  expect(red.getAttribute('aria-checked')).toBe('true')
  fireEvent.keyDown(red, { key: 'ArrowRight' })
  expect(blue.getAttribute('aria-checked')).toBe('true')
  expect(document.activeElement).toBe(blue)
  fireEvent.click(red)
  expect(red.getAttribute('aria-checked')).toBe('true')
})
it('既定のメニューは同じボタンから開く', () => {
  render(<FolderColorButton colors={colors} value="#EF4B55" onChange={() => {}} />)
  expect(screen.getByRole('button', { name: 'フォルダの色：赤' }).getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('radiogroup')).toBeNull()
})
it('保存色が候補外でも選択を1つ表示し、候補色を選んだら保存色の輪を外す', () => {
  function Example() {
    const [value, setValue] = useState<string | null>('#f97316')
    return <FolderColorButton appearance="palette" colors={colors} value={value} onChange={setValue} />
  }
  render(<Example />)
  const current = screen.getByRole('radio', { name: '現在の色（#f97316）' })
  expect(current.getAttribute('data-selected')).toBe('true')
  expect(screen.getAllByRole('radio').filter(el => el.getAttribute('aria-checked') === 'true')).toHaveLength(1)
  fireEvent.click(screen.getByRole('radio', { name: '青' }))
  expect(screen.queryByRole('radio', { name: '現在の色（#f97316）' })).toBeNull()
  expect(screen.getByRole('radio', { name: '青' }).getAttribute('data-selected')).toBe('true')
})
it('その場の丸は24pxと選択の輪。開くメニューの見本点は既存の寸法を保つ', () => {
  const css = readFileSync(`${__dirname}/folder-color-button.module.css`, 'utf8')
  expect(css).toMatch(/\.paletteFlat \.swatch\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/)
  expect(css).toMatch(/\.paletteFlat \.swatch\[data-selected\]\s*\{[^}]*outline-color:\s*var\(--color-ink\);[^}]*outline-offset:\s*2px;/)
  expect(css).toMatch(/\.swatch\s*\{[^}]*width:\s*var\(--select-menu-swatch\);/)
})
