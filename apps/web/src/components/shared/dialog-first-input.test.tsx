// @vitest-environment happy-dom
import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import Dialog from './dialog'
import { TextField } from './text-field'
afterEach(cleanup)
it('サーバーの窓の内容を保ち、利用できる最初の入力欄は打った後も同じDOMで値を保つ', () => {
  function Input() {
    const [value, setValue] = useState('')
    return <TextField aria-label="見出し" value={value} onChange={event => setValue(event.target.value)} />
  }
  const view = <Dialog open title="編集" onCancel={() => {}}><Input /></Dialog>
  expect(renderToStaticMarkup(view)).toContain('aria-label="見出し"')
  render(view)
  const input = screen.getByRole('textbox', { name: '見出し' }) as HTMLInputElement
  fireEvent.change(input, { target: { value: '最初に入れた見出し' } })
  expect(screen.getByRole('textbox', { name: '見出し' })).toBe(input)
  expect(input.value).toBe('最初に入れた見出し')
})
