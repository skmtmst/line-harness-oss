// @vitest-environment happy-dom
import { useLayoutEffect, useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import Dialog from './dialog'
import { TextField } from './text-field'
afterEach(cleanup)
it('開いた窓の入力DOMを作り直さず、最初の入力から値を保つ', () => {
  const mounted: HTMLInputElement[] = []
  function Input() {
    const ref = useRef<HTMLInputElement>(null)
    const [value, setValue] = useState('')
    useLayoutEffect(() => { if (ref.current) mounted.push(ref.current) }, [])
    return <TextField ref={ref} aria-label="見出し" value={value} onChange={event => setValue(event.target.value)} />
  }
  render(<Dialog open title="編集" onCancel={() => {}}><Input /></Dialog>)
  const input = screen.getByRole('textbox', { name: '見出し' }) as HTMLInputElement
  expect(mounted).toEqual([input])
  fireEvent.change(input, { target: { value: '最初に入れた見出し' } })
  expect(screen.getByRole('textbox', { name: '見出し' })).toBe(input)
  expect(input.value).toBe('最初に入れた見出し')
  expect(mounted).toEqual([input])
})
