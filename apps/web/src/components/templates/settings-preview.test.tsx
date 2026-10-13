// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SettingsPage } from './settings-page'
afterEach(cleanup)
it('設定の右欄の見本はカード指定が無くても窓で開け、本文の編集を保持する', () => {
  render(<SettingsPage title="設定" navigation="目次" preview={<p>回答フォームの見本</p>}><input aria-label="編集中の設定" defaultValue="変更前" /></SettingsPage>)
  fireEvent.change(screen.getByRole('textbox', { name: '編集中の設定' }), { target: { value: '変更後' } })
  fireEvent.click(screen.getByRole('button', { name: 'プレビューを開く' }))
  const dialog = screen.getByRole('dialog', { name: 'プレビュー' })
  expect(within(dialog).getByText('回答フォームの見本')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect((screen.getByRole('textbox', { name: '編集中の設定' }) as HTMLInputElement).value).toBe('変更後')
})
it('右欄が無い設定では見本を開く操作を出さない', () => {
  render(<SettingsPage title="設定" navigation="目次">本文</SettingsPage>)
  expect(screen.queryByRole('button', { name: 'プレビューを開く' })).toBeNull()
})
