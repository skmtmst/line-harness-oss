// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { CreateStepColumns } from './create-step-columns'

afterEach(cleanup)

it('右欄と同じ内容を役目名の窓で確認し、閉じても入力値を保つ', () => {
  render(<CreateStepColumns previewTitle="登録内容" preview={<p>担当：店長</p>}><input aria-label="表示名" defaultValue="入力前" /></CreateStepColumns>)
  const input = screen.getByRole('textbox', { name: '表示名' }) as HTMLInputElement
  fireEvent.change(input, { target: { value: '変更した店舗' } })
  expect(within(screen.getByRole('complementary', { name: '登録内容' })).getByText('担当：店長')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '登録内容を見る' }))
  const dialog = screen.getByRole('dialog', { name: '登録内容' })
  expect(within(dialog).getByText('担当：店長')).toBeTruthy()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(input.value).toBe('変更した店舗')
})
