// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FormNameField } from './form-name-field'

afterEach(cleanup)

test('閲覧だけの名前欄は値を読めるが、入力や離れた時の変更処理を呼ばない', () => {
  const onChange = vi.fn()
  const onBlur = vi.fn()
  render(<FormNameField value="読み取れる名前" error={null} readOnly onChange={onChange} onBlur={onBlur} />)
  const value = screen.getByText('読み取れる名前')
  expect(screen.getByText('フォーム名')).toBeTruthy()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(document.querySelector('input, textarea')).toBeNull()
  fireEvent.click(value)
  fireEvent.blur(value)
  expect(onChange).not.toHaveBeenCalled()
  expect(onBlur).not.toHaveBeenCalled()
})
