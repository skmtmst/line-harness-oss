// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import FolderColorButton from './folder-color-button'
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
