// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Combobox from './combobox'
afterEach(cleanup)

it.each([{ isComposing: true }, { keyCode: 229 }])('WEB-018: IME %j のEnterで候補を選ばず、候補なしでも新規作成しない', (ime) => {
  const change = vi.fn(), create = vi.fn()
  const view = render(<Combobox aria-label="候補" value="" onChange={change} onCreate={create} defaultOpen
    options={[{ value: 'winter', label: '冬の案内' }]} />)
  const input = screen.getByRole('combobox')
  fireEvent.change(input, { target: { value: '冬' } })
  fireEvent.keyDown(input, { key: 'Enter', ...ime })
  expect(change).not.toHaveBeenCalled()
  expect(input.getAttribute('aria-expanded')).toBe('true')
  view.rerender(<Combobox aria-label="候補" value="" onChange={change} onCreate={create} options={[]} />)
  fireEvent.keyDown(input, { key: 'Enter', ...ime })
  expect(create).not.toHaveBeenCalled()
  expect(input.getAttribute('aria-expanded')).toBe('true')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(create).toHaveBeenCalledExactlyOnceWith('冬')
})
