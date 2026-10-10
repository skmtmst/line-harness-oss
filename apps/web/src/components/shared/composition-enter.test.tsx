// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TextField, TextArea } from './text-field'
import SearchField from './search-field'

afterEach(cleanup)
it.each([TextField, TextArea, SearchField])('決まり10：変換中のEnterは実行せず、通常のEnterだけ渡す（%s）', (Control) => {
  const run = vi.fn(), parent = vi.fn()
  render(<div onKeyDown={parent}><Control aria-label="入力" onChange={() => {}} onKeyDown={run} /></div>)
  const input = screen.getByLabelText('入力')
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
  expect(run).not.toHaveBeenCalled()
  expect(parent).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(run).toHaveBeenCalledTimes(1)
})
