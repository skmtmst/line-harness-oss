// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import KeywordInput from './keyword-input'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from './save-form-errors'

afterEach(cleanup)

it('Enter・カンマ・離れる操作で1語を確定し、空白だけでは足さない', () => {
  const add = vi.fn()
  render(<KeywordInput id="words" label="反応する言葉を足す" onAdd={add} />)
  const input = screen.getByRole('textbox', { name: '反応する言葉を足す' }) as HTMLInputElement
  for (const [word, key] of [['  予約  ', 'Enter'], ['日程', ',']]) {
    fireEvent.change(input, { target: { value: word } }); fireEvent.keyDown(input, { key })
    expect(input.value).toBe('')
  }
  fireEvent.change(input, { target: { value: '変更' } }); fireEvent.blur(input)
  fireEvent.change(input, { target: { value: '  ' } }); fireEvent.keyDown(input, { key: 'Enter' })
  expect(add.mock.calls).toEqual([['予約'], ['日程'], ['変更']])
})

it('日本語変換のEnterでは追加せず、変換完了後に確定する', () => {
  const add = vi.fn()
  render(<KeywordInput id="words" label="言葉を足す" onAdd={add} />)
  const input = screen.getByRole('textbox', { name: '言葉を足す' })
  fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: '予約' } })
  fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.blur(input)
  expect(add).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input); fireEvent.keyDown(input, { key: 'Enter' })
  expect(add).toHaveBeenCalledExactlyOnceWith('予約')
})

it('欄の誤りを読み上げへつなぎ、題のない任意札を出さない', () => {
  render(<><KeywordInput id="words" label="言葉を足す" error="反応する言葉を入れてください" errorId="words-error" onAdd={vi.fn()} /><p id="words-error">反応する言葉を入れてください</p></>)
  const input = screen.getByRole('textbox', { name: '言葉を足す' })
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(input.getAttribute('aria-describedby')).toBe('words-error')
  expect(screen.queryByText('任意')).toBeNull()
})

it('保存時の欄の誤りは入力を残し、打ち直しで解除する', () => {
  function Form() {
    const errors = useSaveFormErrors()
    return <SaveErrorScope errors={errors}><SaveErrorField names={['value']}><KeywordInput id="words" label="言葉を足す" onAdd={vi.fn()} /></SaveErrorField>
      <button onClick={() => errors.capture({ status: 422, fields: { value: '言葉を短くしてください' } })}>保存の誤り</button></SaveErrorScope>
  }
  render(<Form />)
  const input = screen.getByRole('textbox', { name: '言葉を足す' }) as HTMLInputElement
  fireEvent.change(input, { target: { value: '予約変更' } })
  fireEvent.click(screen.getByRole('button', { name: '保存の誤り' }))
  expect(screen.getByRole('alert').textContent).toBe('言葉を短くしてください')
  expect(input.value).toBe('予約変更')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  fireEvent.input(input)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(input.getAttribute('aria-invalid')).not.toBe('true')
})
