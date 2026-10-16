// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import ImageMultiSelect from './image-multi-select'
afterEach(cleanup)
it('上限では選択済みだけ外せて、空いた枠へ別の画像を選び直せる', () => {
  const items = ['a', 'b', 'c'].map(id => ({ id, name: id, url: `/${id}.png`, size: '100×100' }))
  function Page() {
    const [selected, setSelected] = useState(['a', 'b'])
    return <ImageMultiSelect items={items} selectedIds={selected} max={2} onToggle={id => setSelected(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])} />
  }
  render(<Page />)
  expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true')
  const [a, b, c] = screen.getAllByRole('option') as HTMLButtonElement[]
  expect(c.disabled).toBe(true)
  expect(a.disabled).toBe(false)
  fireEvent.click(a)
  expect(a.getAttribute('aria-selected')).toBe('false')
  expect(c.disabled).toBe(false)
  fireEvent.click(c)
  expect(c.textContent).toContain('2枚目')
  expect(b.textContent).toContain('1枚目')
  expect(a.disabled).toBe(true)
})
