// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TextField } from '@/components/shared/text-field'
import { useFieldValidation } from './use-field-validation'

function SaveForm({ save }: { save: () => void }) {
  const fields = useFieldValidation()
  return <form onSubmit={event => {
    event.preventDefault()
    if (!(document.getElementById('name') as HTMLInputElement).value.trim()) {
      fields.reject('name', '名前を入力してください')
      return
    }
    save()
  }}>
    <label htmlFor="name">名前</label>
    <TextField id="name" {...fields.attributes('name')} />
    {fields.error('name') ? <p id="name-error" role="alert">{fields.error('name')}</p> : null}
    <button>保存</button>
  </form>
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('空欄の保存を止め、理由を1か所に出して赤枠の欄へ焦点とスクロールを移す', async () => {
  const save = vi.fn()
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
  render(<SaveForm save={save} />)
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  const input = screen.getByLabelText('名前')
  await waitFor(() => expect(document.activeElement).toBe(input))
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(input.getAttribute('aria-describedby')).toBe('name-error')
  expect(screen.getAllByText('名前を入力してください')).toHaveLength(1)
  expect(scroll).toHaveBeenCalledWith({ block: 'center' })
  expect(save).not.toHaveBeenCalled()
  await act(async () => { fireEvent.input(input, { target: { value: 'フォームA' } }) })
  expect(input.hasAttribute('aria-invalid')).toBe(false)
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(save).toHaveBeenCalledTimes(1)
})
