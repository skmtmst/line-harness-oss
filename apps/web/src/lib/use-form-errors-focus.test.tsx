// @vitest-environment happy-dom
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useFormErrors } from './use-form-errors'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('focuses the API error field after its saving state commits, even if a frame ran before that commit', () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  function SavingForm() {
    const [saving, setSaving] = useState(true)
    const fields = useFormErrors()
    fields.define('name', '名前', () => null)
    return <><input aria-label="名前" disabled={saving} {...fields.bind('name')} />
      <button onClick={() => { fields.setServerErrors({ name: '名前を直してください' }); setSaving(false) }}>保存の失敗</button>
      <span>{fields.error('name')}</span></>
  }
  render(<SavingForm />)
  const input = screen.getByRole('textbox', { name: '名前' }) as HTMLInputElement
  expect(input.disabled).toBe(true)
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: '保存の失敗' }))
    // Model a frame that runs before React commits the queued enable update.
    frames.splice(0).forEach(frame => frame(0))
  })
  expect(input.disabled).toBe(false)
  act(() => { frames.splice(0).forEach(frame => frame(1)) })
  expect(screen.getByText('名前を直してください')).toBeTruthy()
  expect(document.activeElement).toBe(input)
})
