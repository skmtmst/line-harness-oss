// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { CreatePage } from './create-page'
afterEach(cleanup)
it('畳んだ右欄の見本を共通の入口から確認し、入力を残して閉じる', () => {
  render(<CreatePage title="作る" hidePreviewWhenNarrow preview={<p>送る本文の見本</p>} footerActions={null}><input aria-label="名前" defaultValue="下書き" /></CreatePage>)
  fireEvent.click(screen.getByRole('button', { name: 'LINEの見え方を確認' }))
  const dialog = screen.getByRole('dialog', { name: 'LINEの見え方' })
  expect(within(dialog).getByText('送る本文の見本')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect((screen.getByLabelText('名前') as HTMLInputElement).value).toBe('下書き')
})
it('画面が持つ既存の入口を重ねない', () => {
  render(<CreatePage title="作る" hidePreviewWhenNarrow preview={<p>見本</p>} previewToggle={<button>この画面の見本</button>} footerActions={null}>入力</CreatePage>)
  expect(screen.getByRole('button', { name: 'この画面の見本' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'LINEの見え方を確認' })).toBeNull()
})
